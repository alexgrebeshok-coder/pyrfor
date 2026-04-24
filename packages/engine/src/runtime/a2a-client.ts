/**
 * a2a-client.ts — Pyrfor A2A (Agent-to-Agent) protocol client.
 *
 * Allows Pyrfor to discover, register, and call remote agents over HTTP/JSON.
 *
 * Protocol endpoints expected on each remote agent:
 *   GET  {baseUrl}/.well-known/a2a-card       → { name, version, skills[] }
 *   POST {baseUrl}/skills/{skill}/invoke       → { output } | { error }
 *
 * Mirrors the structural patterns of acp-client.ts and mcp-client.ts but uses
 * Node global fetch (Node 20+) instead of stdio transports.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface A2AAgentConfig {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  authToken?: string;
  startupTimeoutMs?: number;  // default 10_000
  callTimeoutMs?: number;     // default 60_000
}

export interface A2ASkillDescriptor {
  agentName: string;
  skill: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface A2ACallResult {
  ok: boolean;
  output?: any;
  raw?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
}

export interface A2AClient {
  register(cfg: A2AAgentConfig): Promise<void>;
  unregister(name: string): Promise<void>;
  shutdown(): Promise<void>;
  listAgents(): string[];
  listSkills(agentName?: string): A2ASkillDescriptor[];
  call(agentName: string, skill: string, input: Record<string, unknown>): Promise<A2ACallResult>;
  isRegistered(name: string): boolean;
  on(event: 'register' | 'unregister' | 'skill' | 'call', cb: (payload: any) => void): () => void;
}

export interface CreateA2AClientOptions {
  fetchImpl?: typeof fetch;
  retries?: number;         // default 1
  retryBackoffMs?: number;  // default 250
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  clock?: () => number;
}

// ── Internal: timeout error ────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

// ── A2AClientImpl ─────────────────────────────────────────────────────────────

class A2AClientImpl implements A2AClient {
  private readonly _agents    = new Map<string, A2AAgentConfig>();
  private readonly _skills    = new Map<string, A2ASkillDescriptor[]>();
  private readonly _listeners = new Map<string, Set<(payload: any) => void>>();
  private _shuttingDown = false;

  private readonly _fetch:          typeof fetch;
  private readonly _retries:        number;
  private readonly _retryBackoffMs: number;
  private readonly _log:            NonNullable<CreateA2AClientOptions['logger']>;
  private readonly _clock:          () => number;

  constructor(opts: CreateA2AClientOptions = {}) {
    this._fetch          = opts.fetchImpl       ?? globalThis.fetch.bind(globalThis);
    this._retries        = opts.retries         ?? 1;
    this._retryBackoffMs = opts.retryBackoffMs  ?? 250;
    this._log            = opts.logger          ?? (() => {});
    this._clock          = opts.clock           ?? (() => Date.now());
  }

  // ── Event bus ──────────────────────────────────────────────────────────────

  on(
    event: 'register' | 'unregister' | 'skill' | 'call',
    cb: (payload: any) => void,
  ): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(cb);
    return () => { this._listeners.get(event)?.delete(cb); };
  }

  private _emit(event: string, payload: any): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (e) {
        this._log('warn', `[A2A] Event subscriber threw on '${event}'`, { error: String(e) });
      }
    }
  }

  // ── register ───────────────────────────────────────────────────────────────

  async register(cfg: A2AAgentConfig): Promise<void> {
    if (this._agents.has(cfg.name)) {
      throw new Error(`[A2A] duplicate agent name: '${cfg.name}'`);
    }

    const url       = `${cfg.baseUrl}/.well-known/a2a-card`;
    const headers   = this._buildHeaders(cfg);
    const timeoutMs = cfg.startupTimeoutMs ?? 10_000;

    this._log('info', `[A2A] Registering agent '${cfg.name}'…`);

    let res: Response;
    try {
      res = await this._fetchWithTimeout(url, { headers }, timeoutMs);
    } catch (e) {
      this._log('error', `[A2A] Failed to fetch card for '${cfg.name}'`, { error: String(e) });
      throw e;
    }

    // Throws SyntaxError if body is not valid JSON — which is the intended
    // behaviour for "card non-JSON → register rejects".
    const body = await res.json();

    const rawSkills: unknown[] = Array.isArray(body?.skills) ? body.skills : [];

    const skills: A2ASkillDescriptor[] = rawSkills.map((s: any) => ({
      agentName:    cfg.name,
      skill:        s.skill ?? s.id ?? s.name ?? '',
      description:  s.description,
      inputSchema:  s.inputSchema,
      outputSchema: s.outputSchema,
    }));

    this._agents.set(cfg.name, cfg);
    this._skills.set(cfg.name, skills);

    this._log('info', `[A2A] Registered agent '${cfg.name}', ${skills.length} skill(s)`);
    this._emit('register', { agentName: cfg.name });
    for (const s of skills) this._emit('skill', s);
  }

  // ── unregister ─────────────────────────────────────────────────────────────

  async unregister(name: string): Promise<void> {
    this._agents.delete(name);
    this._skills.delete(name);
    this._emit('unregister', { agentName: name });
    this._log('info', `[A2A] Unregistered agent '${name}'`);
  }

  // ── shutdown ───────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this._shuttingDown && this._agents.size === 0) return;
    this._shuttingDown = true;
    this._agents.clear();
    this._skills.clear();
  }

  // ── registry ───────────────────────────────────────────────────────────────

  listAgents(): string[] {
    return [...this._agents.keys()];
  }

  listSkills(agentName?: string): A2ASkillDescriptor[] {
    if (agentName !== undefined) return this._skills.get(agentName) ?? [];
    const all: A2ASkillDescriptor[] = [];
    for (const descriptors of this._skills.values()) all.push(...descriptors);
    return all;
  }

  isRegistered(name: string): boolean {
    return this._agents.has(name);
  }

  // ── call ───────────────────────────────────────────────────────────────────

  async call(
    agentName: string,
    skill: string,
    input: Record<string, unknown>,
  ): Promise<A2ACallResult> {
    const cfg = this._agents.get(agentName);
    if (!cfg) {
      return { ok: false, error: 'no such agent', durationMs: 0, retries: 0 };
    }

    const url       = `${cfg.baseUrl}/skills/${skill}/invoke`;
    const timeoutMs = cfg.callTimeoutMs ?? 60_000;
    const callHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this._buildHeaders(cfg),
    };
    const body  = JSON.stringify({ input });
    const start = this._clock();

    let attempt = 0;

    while (true) {
      try {
        const res = await this._fetchWithTimeout(
          url,
          { method: 'POST', headers: callHeaders, body },
          timeoutMs,
        );

        const durationMs = this._clock() - start;

        if (res.ok) {
          let resBody: any;
          try { resBody = await res.json(); } catch { resBody = {}; }
          const output = resBody?.output !== undefined ? resBody.output : resBody;
          this._emit('call', { agentName, skill, ok: true, durationMs });
          return { ok: true, output, raw: resBody, durationMs, retries: attempt };
        }

        // 5xx — retry if attempts remain
        if (res.status >= 500 && attempt < this._retries) {
          await this._sleep(this._retryBackoffMs * (attempt + 1));
          attempt++;
          continue;
        }

        // 4xx or exhausted retries on 5xx — no further retry
        let errMsg = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          if (typeof errBody?.error === 'string') errMsg = errBody.error;
        } catch { /* keep HTTP status string */ }

        this._emit('call', { agentName, skill, ok: false, durationMs });
        return { ok: false, error: errMsg, durationMs, retries: attempt };

      } catch (e: any) {
        if (e instanceof TimeoutError) {
          const durationMs = this._clock() - start;
          this._emit('call', { agentName, skill, ok: false, durationMs });
          return { ok: false, error: 'timeout', durationMs, retries: attempt };
        }

        // Network / transient error — retry if attempts remain
        if (attempt < this._retries) {
          await this._sleep(this._retryBackoffMs * (attempt + 1));
          attempt++;
          continue;
        }

        const durationMs = this._clock() - start;
        this._emit('call', { agentName, skill, ok: false, durationMs });
        return {
          ok:        false,
          error:     e?.message ?? String(e),
          durationMs,
          retries:   attempt,
        };
      }
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private _buildHeaders(cfg: A2AAgentConfig): Record<string, string> {
    const h: Record<string, string> = { ...(cfg.headers ?? {}) };
    if (cfg.authToken) h['Authorization'] = `Bearer ${cfg.authToken}`;
    return h;
  }

  /**
   * Wraps a fetch call with a racing Promise-based timeout so fake timers
   * in tests can trigger the timeout without needing AbortController support.
   */
  private async _fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let timeoutHandle!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    });
    try {
      const res = await Promise.race([this._fetch(url, init), timeoutPromise]);
      clearTimeout(timeoutHandle);
      return res;
    } catch (e) {
      clearTimeout(timeoutHandle);
      throw e;
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createA2AClient(opts?: CreateA2AClientOptions): A2AClient {
  return new A2AClientImpl(opts);
}
