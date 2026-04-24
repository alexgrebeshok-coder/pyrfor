/**
 * Token / Cost Budget Controller
 *
 * Tracks LLM token and USD consumption across task / session / global scopes,
 * enforces configurable per-window limits, emits warnings and block events, and
 * persists state atomically across restarts.
 *
 * No external dependencies — only node:fs/promises and node:path.
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ── Public types ─────────────────────────────────────────────────────────────

export type BudgetScope = 'task' | 'session' | 'global';
export type BudgetWindow = 'hour' | 'day' | 'month' | 'total';

export interface BudgetRule {
  id: string;
  scope: BudgetScope;
  window: BudgetWindow;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Emit a 'warn' event when usage reaches this percentage of the limit (0-100). */
  warnAtPercent?: number;
  /** For scope='task'|'session': restrict to a specific targetId. */
  targetId?: string;
}

export interface Consumption {
  ts: number;
  scope: BudgetScope;
  targetId?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  provider?: string;
}

export interface ConsumeRequest {
  scope: BudgetScope;
  targetId?: string;
  estPromptTokens: number;
  estCompletionTokens: number;
  estCostUsd: number;
}

export interface CanConsumeResult {
  allowed: boolean;
  blockingRule?: string;
  remainingTokens?: number;
  remainingCostUsd?: number;
}

export interface WindowUsage {
  tokens: number;
  costUsd: number;
  windowStart: number;
  windowEnd: number;
}

export interface RuleSnapshot {
  rule: BudgetRule;
  usage: WindowUsage;
  percentUsed: number;
}

export interface BudgetSnapshot {
  rules: RuleSnapshot[];
  totalConsumption: number;
  totalCostUsd: number;
}

type EventName = 'consume' | 'warn' | 'block';
type EventCallback = (payload: unknown) => void;
type Unsubscribe = () => void;

export interface TokenBudgetController {
  addRule(rule: BudgetRule): void;
  removeRule(id: string): void;
  listRules(): BudgetRule[];

  canConsume(req: ConsumeRequest): CanConsumeResult;
  recordConsumption(c: Consumption): { warnings: string[] };

  usageFor(rule: BudgetRule): WindowUsage;
  reportSnapshot(): BudgetSnapshot;

  flush(): Promise<void>;
  reset(scope?: BudgetScope): void;

  on(event: EventName, cb: EventCallback): Unsubscribe;
}

// ── Persisted state shape ────────────────────────────────────────────────────

interface PersistedState {
  rules: BudgetRule[];
  consumptions: Consumption[];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface TokenBudgetControllerOptions {
  storePath: string;
  rules?: BudgetRule[];
  clock?: () => number;
  flushDebounceMs?: number;
  logger?: (msg: string, meta?: unknown) => void;
}

export function createTokenBudgetController(
  opts: TokenBudgetControllerOptions,
): TokenBudgetController {
  const {
    storePath,
    clock = () => Date.now(),
    flushDebounceMs = 2_000,
    logger: log,
  } = opts;

  // ── State ────────────────────────────────────────────────────────────────

  let rules: BudgetRule[] = [];
  let consumptions: Consumption[] = [];
  // Track which rule ids have already warned in the current window, to avoid repeat events.
  const warnedRules = new Set<string>();

  // ── Load persisted state ─────────────────────────────────────────────────

  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (Array.isArray(parsed.consumptions)) consumptions = parsed.consumptions;
    if (Array.isArray(parsed.rules)) rules = parsed.rules;
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (!isNotFound) {
      log?.('token-budget: corrupt or unreadable store, starting fresh', {
        storePath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Merge any rules passed at construction time (construction opts take precedence by id).
  if (opts.rules) {
    const constructionIds = new Set(opts.rules.map((r) => r.id));
    rules = [...rules.filter((r) => !constructionIds.has(r.id)), ...opts.rules];
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  const listeners: Map<EventName, Set<EventCallback>> = new Map([
    ['consume', new Set()],
    ['warn', new Set()],
    ['block', new Set()],
  ]);

  function emit(event: EventName, payload: unknown): void {
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(payload);
      } catch {
        // swallow listener errors
      }
    }
  }

  // ── Flush / persistence ──────────────────────────────────────────────────

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPending = false;

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushPending = true;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void doFlush();
    }, flushDebounceMs);
  }

  async function doFlush(): Promise<void> {
    flushPending = false;
    const state: PersistedState = { rules: [...rules], consumptions: [...consumptions] };
    const content = JSON.stringify(state, null, 2);
    const tmp = `${storePath}.tmp-${clock()}`;
    try {
      mkdirSync(dirname(storePath), { recursive: true });
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, storePath);
    } catch (err) {
      log?.('token-budget: flush failed', { err: err instanceof Error ? err.message : String(err) });
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  }

  // ── Window math ───────────────────────────────────────────────────────────

  function windowStart(window: BudgetWindow, now: number): number {
    switch (window) {
      case 'hour':
        return now - 3_600_000;
      case 'day': {
        const d = new Date(now);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      case 'month': {
        const d = new Date(now);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      }
      case 'total':
        return 0;
    }
  }

  // ── Scope matching ────────────────────────────────────────────────────────

  function consumptionMatchesRule(c: Consumption, rule: BudgetRule): boolean {
    if (c.scope !== rule.scope) return false;
    if (rule.targetId !== undefined && c.targetId !== rule.targetId) return false;
    return true;
  }

  function requestMatchesRule(
    req: ConsumeRequest,
    rule: BudgetRule,
  ): boolean {
    if (req.scope !== rule.scope) return false;
    if (rule.targetId !== undefined && req.targetId !== rule.targetId) return false;
    return true;
  }

  // ── Core helpers ──────────────────────────────────────────────────────────

  function usageForRule(rule: BudgetRule, now: number): WindowUsage {
    const start = windowStart(rule.window, now);
    const end = now;
    let tokens = 0;
    let costUsd = 0;
    for (const c of consumptions) {
      if (c.ts < start) continue;
      if (!consumptionMatchesRule(c, rule)) continue;
      tokens += c.promptTokens + c.completionTokens;
      costUsd += c.costUsd;
    }
    return { tokens, costUsd, windowStart: start, windowEnd: end };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function addRule(rule: BudgetRule): void {
    rules = [...rules.filter((r) => r.id !== rule.id), rule];
    scheduleFlush();
  }

  function removeRule(id: string): void {
    rules = rules.filter((r) => r.id !== id);
    warnedRules.delete(id);
    scheduleFlush();
  }

  function listRules(): BudgetRule[] {
    return [...rules];
  }

  function canConsume(req: ConsumeRequest): CanConsumeResult {
    const now = clock();
    const estTokens = req.estPromptTokens + req.estCompletionTokens;

    for (const rule of rules) {
      if (!requestMatchesRule(req, rule)) continue;

      const usage = usageForRule(rule, now);
      const projectedTokens = usage.tokens + estTokens;
      const projectedCost = usage.costUsd + req.estCostUsd;

      if (rule.maxTokens !== undefined && projectedTokens > rule.maxTokens) {
        emit('block', { rule: rule.id, req });
        return {
          allowed: false,
          blockingRule: rule.id,
          remainingTokens: Math.max(0, rule.maxTokens - usage.tokens),
          remainingCostUsd: rule.maxCostUsd !== undefined
            ? Math.max(0, rule.maxCostUsd - usage.costUsd)
            : undefined,
        };
      }

      if (rule.maxCostUsd !== undefined && projectedCost > rule.maxCostUsd) {
        emit('block', { rule: rule.id, req });
        return {
          allowed: false,
          blockingRule: rule.id,
          remainingTokens: rule.maxTokens !== undefined
            ? Math.max(0, rule.maxTokens - usage.tokens)
            : undefined,
          remainingCostUsd: Math.max(0, rule.maxCostUsd - usage.costUsd),
        };
      }
    }

    return { allowed: true };
  }

  function recordConsumption(c: Consumption): { warnings: string[] } {
    consumptions.push(c);
    emit('consume', c);

    const now = clock();
    const triggered: string[] = [];

    for (const rule of rules) {
      if (!consumptionMatchesRule(c, rule)) continue;

      const usage = usageForRule(rule, now);

      // Check hard limits — emit block if exceeded after the fact
      const overTokens = rule.maxTokens !== undefined && usage.tokens > rule.maxTokens;
      const overCost = rule.maxCostUsd !== undefined && usage.costUsd > rule.maxCostUsd;
      if (overTokens || overCost) {
        emit('block', { rule: rule.id, consumption: c, usage });
      }

      // Warning threshold
      if (rule.warnAtPercent !== undefined && !warnedRules.has(rule.id)) {
        const tokenPct =
          rule.maxTokens !== undefined ? (usage.tokens / rule.maxTokens) * 100 : 0;
        const costPct =
          rule.maxCostUsd !== undefined ? (usage.costUsd / rule.maxCostUsd) * 100 : 0;
        const pct = Math.max(tokenPct, costPct);

        if (pct >= rule.warnAtPercent) {
          warnedRules.add(rule.id);
          triggered.push(rule.id);
          emit('warn', { rule: rule.id, pct, usage });
          log?.(`token-budget: warn threshold reached for rule ${rule.id}`, { pct, usage });
        }
      }
    }

    scheduleFlush();
    return { warnings: triggered };
  }

  function usageFor(rule: BudgetRule): WindowUsage {
    return usageForRule(rule, clock());
  }

  function reportSnapshot(): BudgetSnapshot {
    const now = clock();
    let totalConsumption = 0;
    let totalCostUsd = 0;
    for (const c of consumptions) {
      totalConsumption += c.promptTokens + c.completionTokens;
      totalCostUsd += c.costUsd;
    }

    const ruleSnapshots: RuleSnapshot[] = rules.map((rule) => {
      const usage = usageForRule(rule, now);
      const limit = rule.maxTokens ?? rule.maxCostUsd ?? 1;
      const usedValue = rule.maxTokens !== undefined ? usage.tokens : usage.costUsd;
      const percentUsed = (usedValue / limit) * 100;
      return { rule, usage, percentUsed };
    });

    return { rules: ruleSnapshots, totalConsumption, totalCostUsd };
  }

  async function flush(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await doFlush();
  }

  function reset(scope?: BudgetScope): void {
    if (scope === undefined) {
      consumptions = [];
      warnedRules.clear();
    } else {
      consumptions = consumptions.filter((c) => c.scope !== scope);
      // Clear warned state for rules of that scope so they can warn again
      for (const rule of rules) {
        if (rule.scope === scope) warnedRules.delete(rule.id);
      }
    }
    scheduleFlush();
  }

  function on(event: EventName, cb: EventCallback): Unsubscribe {
    listeners.get(event)!.add(cb);
    return () => listeners.get(event)!.delete(cb);
  }

  return {
    addRule,
    removeRule,
    listRules,
    canConsume,
    recordConsumption,
    usageFor,
    reportSnapshot,
    flush,
    reset,
    on,
  };
}
