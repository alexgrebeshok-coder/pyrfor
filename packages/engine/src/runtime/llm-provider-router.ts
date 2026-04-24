/**
 * llm-provider-router.ts — Pyrfor intelligent LLM provider router.
 *
 * Smart multi-provider LLM router featuring:
 *   - Rolling-window health tracking (success rate + avg latency per provider)
 *   - Circuit breaker: N consecutive failures → open for cooldownMs
 *   - Half-open probing: one trial after cooldown; success closes, failure re-opens
 *   - Capability-based provider filtering (chat/tools/vision/audio/embedding)
 *   - Cost-aware sorting: preferCheapFor='simple' selects cheapest provider first
 *   - Concurrency caps: maxConcurrent skips saturated providers
 *   - AbortSignal propagation; abort errors are not counted as health failures
 *   - Event system: callStart / callEnd / callError / circuitOpen / circuitClose
 *   - External health recording for out-of-band calls
 *
 * Pure TS, ESM-only, no external dependencies.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type ProviderId = string;

export type Capability = 'chat' | 'tools' | 'vision' | 'audio' | 'embedding';

export type ProviderConfig = {
  id: ProviderId;
  /** Relative preference weight (default 1). Higher = preferred in health ranking. */
  weight?: number;
  /** Cost per 1 000 tokens. Used for cost-aware sorting when preferCheapFor='simple'. */
  costPerKToken?: number;
  /** Modalities supported. If omitted, provider matches all requests with no `needs`. */
  capabilities?: Capability[];
  /** Maximum simultaneous in-flight calls. Undefined = unlimited. */
  maxConcurrent?: number;
  /** The actual LLM call implementation. */
  call: (req: LlmRequest) => Promise<LlmResponse>;
};

export type LlmRequest = {
  messages: { role: string; content: any }[];
  tools?: any[];
  /** Required capabilities. Only providers supporting ALL listed caps are tried. */
  needs?: Capability[];
  maxTokens?: number;
  temperature?: number;
  /**
   * 'simple'  → sort by costPerKToken ascending (cheapest first).
   * 'complex' → health-based ranking (no cost optimisation).
   */
  preferCheapFor?: 'simple' | 'complex';
  signal?: AbortSignal;
};

export type LlmResponse = {
  provider: ProviderId;
  text: string;
  toolCalls?: any[];
  usage?: { promptTokens?: number; completionTokens?: number };
  latencyMs: number;
};

export type ProviderStatus = {
  id: ProviderId;
  /** False when the circuit is open (provider currently in cooldown). */
  healthy: boolean;
  /** Epoch ms until which the circuit remains open. Only present when > 0. */
  circuitOpenUntil?: number;
  successRate: number;
  avgLatencyMs: number;
  activeCalls: number;
};

export type RouterEvent =
  | 'callStart'
  | 'callEnd'
  | 'callError'
  | 'circuitOpen'
  | 'circuitClose';

export type RouterEventCallback = (meta: any) => void;

export interface RouterOptions {
  /** Size of the rolling health window (default 50). */
  healthWindow?: number;
  /** Consecutive failures before opening circuit (default 5). */
  circuitFailures?: number;
  /** How long the circuit stays open in ms (default 30 000). */
  circuitCooldownMs?: number;
  /** Custom clock for deterministic testing. Defaults to Date.now. */
  clock?: () => number;
  /** Optional structured logger. */
  logger?: (msg: string, meta?: any) => void;
}

export interface LlmProviderRouter {
  register(cfg: ProviderConfig): void;
  unregister(id: ProviderId): void;
  listProviders(): ProviderStatus[];
  call(
    req: LlmRequest,
    opts?: { order?: ProviderId[]; maxAttempts?: number },
  ): Promise<LlmResponse>;
  recordExternal(providerId: ProviderId, ok: boolean, latencyMs: number): void;
  resetHealth(providerId?: ProviderId): void;
  on(event: RouterEvent, cb: RouterEventCallback): () => void;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface ProviderEntry {
  cfg: ProviderConfig;
  /** Rolling outcomes: true = success, false = failure. Capped at healthWindow. */
  windowOutcomes: boolean[];
  /** Rolling latencies in ms. Capped at healthWindow. */
  windowLatencies: number[];
  /** Resets to 0 on any success. Never resets from window rollover. */
  consecutiveFailures: number;
  /** Epoch ms until circuit reopens. 0 = circuit is closed. */
  circuitOpenUntil: number;
  /** True while a half-open trial is in-flight (blocks additional trials). */
  halfOpen: boolean;
  activeCalls: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createProviderRouter(opts?: RouterOptions): LlmProviderRouter {
  const healthWindow = opts?.healthWindow ?? 50;
  const circuitFailuresThreshold = opts?.circuitFailures ?? 5;
  const circuitCooldownMs = opts?.circuitCooldownMs ?? 30_000;
  const clock = opts?.clock ?? (() => Date.now());
  const logger = opts?.logger;

  const providers = new Map<ProviderId, ProviderEntry>();
  const listeners = new Map<RouterEvent, Set<RouterEventCallback>>();

  // ── Event helpers ──────────────────────────────────────────────────────────

  function emit(event: RouterEvent, meta?: any): void {
    listeners.get(event)?.forEach(cb => {
      try { cb(meta); } catch { /* swallow listener errors to protect the router */ }
    });
  }

  // ── Health computation ─────────────────────────────────────────────────────

  function computeSuccessRate(entry: ProviderEntry): number {
    if (entry.windowOutcomes.length === 0) return 1; // optimistic default
    return entry.windowOutcomes.filter(Boolean).length / entry.windowOutcomes.length;
  }

  function computeAvgLatency(entry: ProviderEntry): number {
    if (entry.windowLatencies.length === 0) return 0;
    return entry.windowLatencies.reduce((a, b) => a + b, 0) / entry.windowLatencies.length;
  }

  function healthScore(entry: ProviderEntry): number {
    const rate = computeSuccessRate(entry);
    const latencyS = computeAvgLatency(entry) / 1_000;
    const weight = entry.cfg.weight ?? 1;
    // Higher success rate and lower latency → higher score; weight shifts preference.
    return (rate * weight) / (1 + latencyS);
  }

  // ── Circuit breaker helpers ────────────────────────────────────────────────

  function isCircuitOpen(entry: ProviderEntry, now: number): boolean {
    return entry.circuitOpenUntil > 0 && now < entry.circuitOpenUntil;
  }

  function isHalfOpenEligible(entry: ProviderEntry, now: number): boolean {
    // Cooldown has expired but circuit was opened → allow one probe.
    return entry.circuitOpenUntil > 0 && now >= entry.circuitOpenUntil;
  }

  // ── Outcome recording ──────────────────────────────────────────────────────

  function recordOutcome(
    entry: ProviderEntry,
    ok: boolean,
    latencyMs: number,
    isHalfOpenTrial: boolean,
  ): void {
    // Maintain rolling window for both outcomes and latencies.
    entry.windowOutcomes.push(ok);
    entry.windowLatencies.push(latencyMs);
    if (entry.windowOutcomes.length > healthWindow) {
      entry.windowOutcomes.shift();
      entry.windowLatencies.shift();
    }

    if (ok) {
      entry.consecutiveFailures = 0;
      if (isHalfOpenTrial) {
        entry.circuitOpenUntil = 0;
        entry.halfOpen = false;
        emit('circuitClose', { providerId: entry.cfg.id });
        logger?.('circuit closed', { providerId: entry.cfg.id });
      }
    } else {
      entry.consecutiveFailures++;
      if (isHalfOpenTrial) {
        // Half-open trial failed → re-open for another full cooldown.
        entry.halfOpen = false;
        entry.circuitOpenUntil = clock() + circuitCooldownMs;
        emit('circuitOpen', { providerId: entry.cfg.id, until: entry.circuitOpenUntil });
        logger?.('circuit re-opened (half-open failure)', { providerId: entry.cfg.id });
      } else if (
        entry.consecutiveFailures >= circuitFailuresThreshold &&
        entry.circuitOpenUntil === 0
      ) {
        entry.circuitOpenUntil = clock() + circuitCooldownMs;
        emit('circuitOpen', { providerId: entry.cfg.id, until: entry.circuitOpenUntil });
        logger?.('circuit opened', { providerId: entry.cfg.id });
      }
    }
  }

  function resetEntry(entry: ProviderEntry): void {
    entry.windowOutcomes = [];
    entry.windowLatencies = [];
    entry.consecutiveFailures = 0;
    entry.circuitOpenUntil = 0;
    entry.halfOpen = false;
  }

  // ── Candidate sorting ──────────────────────────────────────────────────────

  function sortCandidates(
    entries: ProviderEntry[],
    preferCheapFor: LlmRequest['preferCheapFor'],
    now: number,
  ): ProviderEntry[] {
    return [...entries].sort((a, b) => {
      // Open-circuit providers sort last (half-open-eligible are treated as available).
      const aSkip = isCircuitOpen(a, now);
      const bSkip = isCircuitOpen(b, now);
      if (aSkip !== bSkip) return aSkip ? 1 : -1;

      // Cost-aware: cheapest first for simple tasks.
      if (preferCheapFor === 'simple') {
        const aCost = a.cfg.costPerKToken ?? Infinity;
        const bCost = b.cfg.costPerKToken ?? Infinity;
        if (aCost !== bCost) return aCost - bCost;
      }

      // Health-based tiebreaker: highest composite score first.
      return healthScore(b) - healthScore(a);
    });
  }

  // ── AbortError helpers ─────────────────────────────────────────────────────

  function createAbortError(msg: string): Error {
    if (typeof DOMException !== 'undefined') {
      return new DOMException(msg, 'AbortError');
    }
    const e = new Error(msg);
    e.name = 'AbortError';
    return e;
  }

  function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    register(cfg: ProviderConfig): void {
      if (providers.has(cfg.id)) {
        throw new Error(`Provider '${cfg.id}' is already registered`);
      }
      providers.set(cfg.id, {
        cfg,
        windowOutcomes: [],
        windowLatencies: [],
        consecutiveFailures: 0,
        circuitOpenUntil: 0,
        halfOpen: false,
        activeCalls: 0,
      });
      logger?.('provider registered', { id: cfg.id });
    },

    unregister(id: ProviderId): void {
      providers.delete(id);
      logger?.('provider unregistered', { id });
    },

    listProviders(): ProviderStatus[] {
      const now = clock();
      return [...providers.values()].map(entry => {
        const status: ProviderStatus = {
          id: entry.cfg.id,
          healthy: !isCircuitOpen(entry, now),
          successRate: computeSuccessRate(entry),
          avgLatencyMs: computeAvgLatency(entry),
          activeCalls: entry.activeCalls,
        };
        if (entry.circuitOpenUntil > 0) {
          status.circuitOpenUntil = entry.circuitOpenUntil;
        }
        return status;
      });
    },

    async call(
      req: LlmRequest,
      opts?: { order?: ProviderId[]; maxAttempts?: number },
    ): Promise<LlmResponse> {
      if (req.signal?.aborted) throw createAbortError('Aborted before call');

      // Build candidate list (order-based or full registry).
      let candidates: ProviderEntry[];
      if (opts?.order) {
        candidates = opts.order
          .map(id => providers.get(id))
          .filter((e): e is ProviderEntry => e !== undefined);
      } else {
        candidates = [...providers.values()];
      }

      // Capability filter: must satisfy every requested modality.
      if (req.needs && req.needs.length > 0) {
        candidates = candidates.filter(entry => {
          const caps = entry.cfg.capabilities;
          if (!caps || caps.length === 0) return false;
          return req.needs!.every(need => caps.includes(need));
        });
      }

      // Sort only when the caller hasn't prescribed an order.
      if (!opts?.order) {
        candidates = sortCandidates(candidates, req.preferCheapFor, clock());
      }

      const maxAttempts = opts?.maxAttempts ?? candidates.length;
      let lastError: Error | undefined;
      let attempts = 0;

      for (const entry of candidates) {
        if (attempts >= maxAttempts) break;
        if (req.signal?.aborted) throw createAbortError('Aborted');

        const now = clock();

        // Hard-skip providers whose circuit is still open.
        if (isCircuitOpen(entry, now)) continue;

        // Half-open: allow exactly one in-flight trial after cooldown expiry.
        let isHalfOpenTrial = false;
        if (isHalfOpenEligible(entry, now)) {
          if (entry.halfOpen) continue; // a trial is already in-flight
          isHalfOpenTrial = true;
          entry.halfOpen = true;
        }

        // Concurrency cap: skip saturated providers.
        if (entry.cfg.maxConcurrent !== undefined && entry.activeCalls >= entry.cfg.maxConcurrent) {
          if (isHalfOpenTrial) entry.halfOpen = false; // undo trial reservation
          continue;
        }

        attempts++;
        entry.activeCalls++;
        const callStart = clock();
        emit('callStart', { providerId: entry.cfg.id });

        try {
          const resp = await entry.cfg.call(req);
          const latencyMs = clock() - callStart;
          entry.activeCalls--;

          recordOutcome(entry, true, latencyMs, isHalfOpenTrial);
          emit('callEnd', { providerId: entry.cfg.id, latencyMs, response: resp });

          return {
            provider: entry.cfg.id,
            text: resp.text,
            toolCalls: resp.toolCalls,
            usage: resp.usage,
            latencyMs,
          };
        } catch (err: unknown) {
          const latencyMs = clock() - callStart;
          entry.activeCalls--;

          // Abort errors are not health failures; propagate immediately.
          if (isAbortError(err)) {
            if (isHalfOpenTrial) entry.halfOpen = false;
            throw err;
          }

          recordOutcome(entry, false, latencyMs, isHalfOpenTrial);
          emit('callError', { providerId: entry.cfg.id, error: err, latencyMs });
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      if (req.signal?.aborted) throw createAbortError('Aborted');
      if (lastError) throw lastError;
      throw new Error('No available providers for the given request');
    },

    recordExternal(providerId: ProviderId, ok: boolean, latencyMs: number): void {
      const entry = providers.get(providerId);
      if (!entry) return;
      recordOutcome(entry, ok, latencyMs, false);
    },

    resetHealth(providerId?: ProviderId): void {
      if (providerId !== undefined) {
        const entry = providers.get(providerId);
        if (entry) resetEntry(entry);
      } else {
        for (const entry of providers.values()) resetEntry(entry);
      }
    },

    on(event: RouterEvent, cb: RouterEventCallback): () => void {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => { listeners.get(event)?.delete(cb); };
    },
  };
}
