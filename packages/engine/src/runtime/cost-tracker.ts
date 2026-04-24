/**
 * cost-tracker.ts — Pyrfor K7: per-task and per-session token/USD spend
 * tracker with backpressure signals.
 *
 * Standalone module callable from Ralph runner / Quest mode / ACP supervisor.
 * No external I/O — pure in-memory, pure TS, ESM only.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface ProviderRates {
  /** USD per 1M tokens */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface CostBudget {
  taskUsd?: number;
  sessionUsd?: number;
  taskTokens?: number;
  sessionTokens?: number;
  /** default 0.8 — emit 'warn' before block */
  warnAtPct?: number;
  /** default 3 — abort/raise on >=N× of budget */
  hardStopMultiplier?: number;
}

export interface CostUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface BackpressureSignal {
  level: 'ok' | 'warn' | 'block' | 'hard_stop';
  scope: 'task' | 'session';
  metric: 'usd' | 'tokens';
  current: number;
  limit: number;
  ratio: number;
  reason: string;
}

export interface CostEvent {
  ts: number;
  taskId?: string;
  provider: string;
  model: string;
  usage: CostUsage;
  source: 'llm' | 'embed' | 'transcribe' | 'manual';
}

export interface CostTracker {
  recordUsage(event: Omit<CostEvent, 'ts'> & { ts?: number }): BackpressureSignal[];
  startTask(taskId: string): void;
  endTask(taskId: string, opts?: { abortReason?: string }): void;
  totals(): { task: Record<string, CostUsage>; session: CostUsage };
  events(filter?: { taskId?: string; sinceMs?: number }): CostEvent[];
  pressure(): { task?: BackpressureSignal[]; session: BackpressureSignal[] };
  setBudget(b: CostBudget): void;
  getBudget(): CostBudget;
  reset(): void;
  computeCost(usage: { tokensIn: number; tokensOut: number }, rates: ProviderRates): number;
}

export interface CostTrackerOptions {
  budget?: CostBudget;
  /** keyed by `provider:model` or just `provider` */
  rates?: Record<string, ProviderRates>;
  defaultRates?: ProviderRates;
  /** injectable for tests */
  clock?: () => number;
  onSignal?: (s: BackpressureSignal) => void;
  /** default 5000 (ring buffer) */
  maxEvents?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WARN_PCT = 0.8;
const DEFAULT_HARD_STOP_MULTIPLIER = 3;
const DEFAULT_MAX_EVENTS = 5000;

const LEVEL_ORDER: Record<BackpressureSignal['level'], number> = {
  ok: 0,
  warn: 1,
  block: 2,
  hard_stop: 3,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function zeroUsage(): CostUsage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

function addUsage(a: CostUsage, b: CostUsage): CostUsage {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costUsd: round6(a.costUsd + b.costUsd),
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function computeLevel(
  ratio: number,
  warnAtPct: number,
  hardStopMultiplier: number,
): BackpressureSignal['level'] {
  if (ratio >= hardStopMultiplier) return 'hard_stop';
  if (ratio >= 1) return 'block';
  if (ratio >= warnAtPct) return 'warn';
  return 'ok';
}

function buildSignal(
  scope: BackpressureSignal['scope'],
  metric: BackpressureSignal['metric'],
  current: number,
  limit: number,
  warnAtPct: number,
  hardStopMultiplier: number,
): BackpressureSignal {
  const ratio = limit > 0 ? current / limit : 0;
  const level = computeLevel(ratio, warnAtPct, hardStopMultiplier);
  return {
    level,
    scope,
    metric,
    current,
    limit,
    ratio,
    reason: `${scope} ${metric} ${level}: ${current} of ${limit} (${(ratio * 100).toFixed(1)}%)`,
  };
}

function worstSignal(signals: BackpressureSignal[]): BackpressureSignal | undefined {
  return signals.reduce<BackpressureSignal | undefined>((best, s) => {
    if (!best) return s;
    return LEVEL_ORDER[s.level] > LEVEL_ORDER[best.level] ? s : best;
  }, undefined);
}

// ── defaultProviderRates ──────────────────────────────────────────────────────

/** Build a default rate table for known providers (Anthropic, OpenAI, Zhipu, Ollama). */
export function defaultProviderRates(): Record<string, ProviderRates> {
  return {
    // ── Anthropic ────────────────────────────────────────────────────────────
    'anthropic:claude-3-5-sonnet-20241022': { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    'anthropic:claude-3-5-sonnet-20240620': { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    'anthropic:claude-3-5-haiku-20241022':  { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4.0 },
    'anthropic:claude-3-haiku-20240307':    { inputUsdPerMTok: 0.25, outputUsdPerMTok: 1.25 },
    'anthropic:claude-3-opus-20240229':     { inputUsdPerMTok: 15.0, outputUsdPerMTok: 75.0 },
    'anthropic:claude-3-sonnet-20240229':   { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    anthropic:                              { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    // ── OpenAI ───────────────────────────────────────────────────────────────
    'openai:gpt-4o':                        { inputUsdPerMTok: 5.0, outputUsdPerMTok: 15.0 },
    'openai:gpt-4o-mini':                   { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
    'openai:gpt-4-turbo':                   { inputUsdPerMTok: 10.0, outputUsdPerMTok: 30.0 },
    'openai:gpt-4':                         { inputUsdPerMTok: 30.0, outputUsdPerMTok: 60.0 },
    'openai:gpt-3.5-turbo':                 { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
    openai:                                 { inputUsdPerMTok: 5.0, outputUsdPerMTok: 15.0 },
    // ── Zhipu (GLM) ──────────────────────────────────────────────────────────
    'zhipu:glm-4':                          { inputUsdPerMTok: 7.0, outputUsdPerMTok: 7.0 },
    'zhipu:glm-4-flash':                    { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.1 },
    'zhipu:glm-3-turbo':                    { inputUsdPerMTok: 0.7, outputUsdPerMTok: 0.7 },
    zhipu:                                  { inputUsdPerMTok: 7.0, outputUsdPerMTok: 7.0 },
    // ── Ollama (local — zero cost) ────────────────────────────────────────────
    ollama:                                 { inputUsdPerMTok: 0.0, outputUsdPerMTok: 0.0 },
  };
}

// ── createCostTracker ─────────────────────────────────────────────────────────

export function createCostTracker(opts: CostTrackerOptions = {}): CostTracker {
  const clock = opts.clock ?? (() => Date.now());
  const onSignal = opts.onSignal;
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
  const rateTable = opts.rates ?? {};
  const fallbackRates = opts.defaultRates;

  let budget: CostBudget = opts.budget ? { ...opts.budget } : {};

  // Ring buffer — drop oldest when length > maxEvents
  const _events: CostEvent[] = [];

  let _session: CostUsage = zeroUsage();
  const _taskTotals = new Map<string, CostUsage>();
  const _activeTasks = new Set<string>();

  // ── Private helpers ───────────────────────────────────────────────────────

  function lookupRates(provider: string, model: string): ProviderRates | undefined {
    return rateTable[`${provider}:${model}`] ?? rateTable[provider] ?? fallbackRates;
  }

  function computeFromRates(
    tokensIn: number,
    tokensOut: number,
    rates: ProviderRates,
  ): number {
    return round6((tokensIn / 1e6) * rates.inputUsdPerMTok + (tokensOut / 1e6) * rates.outputUsdPerMTok);
  }

  function hasBudgetSet(): boolean {
    return (
      budget.taskUsd !== undefined ||
      budget.sessionUsd !== undefined ||
      budget.taskTokens !== undefined ||
      budget.sessionTokens !== undefined
    );
  }

  /** Compute worst signal per scope (task + session). Returns only non-ok signals. */
  function computeSignals(taskId?: string): BackpressureSignal[] {
    if (!hasBudgetSet()) return [];

    const warnPct = budget.warnAtPct ?? DEFAULT_WARN_PCT;
    const hardMult = budget.hardStopMultiplier ?? DEFAULT_HARD_STOP_MULTIPLIER;

    const sessionCandidates: BackpressureSignal[] = [];
    const taskCandidates: BackpressureSignal[] = [];

    // Session USD
    if (budget.sessionUsd !== undefined) {
      sessionCandidates.push(
        buildSignal('session', 'usd', _session.costUsd, budget.sessionUsd, warnPct, hardMult),
      );
    }

    // Session tokens
    if (budget.sessionTokens !== undefined) {
      sessionCandidates.push(
        buildSignal(
          'session',
          'tokens',
          _session.tokensIn + _session.tokensOut,
          budget.sessionTokens,
          warnPct,
          hardMult,
        ),
      );
    }

    // Task signals — only when a taskId is present
    if (taskId !== undefined) {
      const tu = _taskTotals.get(taskId) ?? zeroUsage();

      if (budget.taskUsd !== undefined) {
        taskCandidates.push(
          buildSignal('task', 'usd', tu.costUsd, budget.taskUsd, warnPct, hardMult),
        );
      }

      if (budget.taskTokens !== undefined) {
        taskCandidates.push(
          buildSignal(
            'task',
            'tokens',
            tu.tokensIn + tu.tokensOut,
            budget.taskTokens,
            warnPct,
            hardMult,
          ),
        );
      }
    }

    const result: BackpressureSignal[] = [];

    const bestSession = worstSignal(sessionCandidates);
    if (bestSession && bestSession.level !== 'ok') result.push(bestSession);

    const bestTask = worstSignal(taskCandidates);
    if (bestTask && bestTask.level !== 'ok') result.push(bestTask);

    return result;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    computeCost(usage: { tokensIn: number; tokensOut: number }, rates: ProviderRates): number {
      const tIn = Math.max(0, usage.tokensIn);
      const tOut = Math.max(0, usage.tokensOut);
      return computeFromRates(tIn, tOut, rates);
    },

    recordUsage(event: Omit<CostEvent, 'ts'> & { ts?: number }): BackpressureSignal[] {
      const ts = event.ts ?? clock();

      // Clamp negative tokens
      const tokensIn = Math.max(0, event.usage.tokensIn);
      const tokensOut = Math.max(0, event.usage.tokensOut);

      // Resolve cost
      let costUsd: number;
      if (event.usage.costUsd > 0) {
        costUsd = round6(event.usage.costUsd);
      } else {
        const rates = lookupRates(event.provider, event.model);
        costUsd = rates ? computeFromRates(tokensIn, tokensOut, rates) : 0;
      }

      const usage: CostUsage = { tokensIn, tokensOut, costUsd };

      const full: CostEvent = {
        ts,
        taskId: event.taskId,
        provider: event.provider,
        model: event.model,
        usage,
        source: event.source,
      };

      // Ring buffer: push and evict oldest when over cap
      if (maxEvents > 0) {
        _events.push(full);
        if (_events.length > maxEvents) {
          _events.shift();
        }
      }

      // Session totals
      _session = addUsage(_session, usage);

      // Task totals (tracked regardless of active status to handle late arrivals)
      if (event.taskId !== undefined) {
        const prev = _taskTotals.get(event.taskId) ?? zeroUsage();
        _taskTotals.set(event.taskId, addUsage(prev, usage));
      }

      // Backpressure
      if (!hasBudgetSet()) return [];

      const signals = computeSignals(event.taskId);

      if (onSignal) {
        for (const s of signals) {
          onSignal(s);
        }
      }

      return signals;
    },

    startTask(taskId: string): void {
      if (_activeTasks.has(taskId)) return;
      _activeTasks.add(taskId);
      if (!_taskTotals.has(taskId)) {
        _taskTotals.set(taskId, zeroUsage());
      }
    },

    endTask(taskId: string, _opts?: { abortReason?: string }): void {
      _activeTasks.delete(taskId);
      // Totals are preserved — still accessible via totals()
    },

    totals(): { task: Record<string, CostUsage>; session: CostUsage } {
      const task: Record<string, CostUsage> = {};
      for (const [id, usage] of _taskTotals) {
        task[id] = { ...usage };
      }
      return { task, session: { ..._session } };
    },

    events(filter?: { taskId?: string; sinceMs?: number }): CostEvent[] {
      let result = _events.slice();
      if (filter?.taskId !== undefined) {
        result = result.filter((e) => e.taskId === filter.taskId);
      }
      if (filter?.sinceMs !== undefined) {
        const since = filter.sinceMs;
        result = result.filter((e) => e.ts >= since);
      }
      return result;
    },

    pressure(): { task?: BackpressureSignal[]; session: BackpressureSignal[] } {
      if (!hasBudgetSet()) return { session: [] };

      const warnPct = budget.warnAtPct ?? DEFAULT_WARN_PCT;
      const hardMult = budget.hardStopMultiplier ?? DEFAULT_HARD_STOP_MULTIPLIER;

      // Session signals
      const sessionSignals: BackpressureSignal[] = [];

      if (budget.sessionUsd !== undefined) {
        sessionSignals.push(
          buildSignal('session', 'usd', _session.costUsd, budget.sessionUsd, warnPct, hardMult),
        );
      }
      if (budget.sessionTokens !== undefined) {
        sessionSignals.push(
          buildSignal(
            'session',
            'tokens',
            _session.tokensIn + _session.tokensOut,
            budget.sessionTokens,
            warnPct,
            hardMult,
          ),
        );
      }

      // Task signals — one worst per active task
      const taskSignals: BackpressureSignal[] = [];
      for (const taskId of _activeTasks) {
        const tu = _taskTotals.get(taskId) ?? zeroUsage();
        const candidates: BackpressureSignal[] = [];

        if (budget.taskUsd !== undefined) {
          candidates.push(buildSignal('task', 'usd', tu.costUsd, budget.taskUsd, warnPct, hardMult));
        }
        if (budget.taskTokens !== undefined) {
          candidates.push(
            buildSignal('task', 'tokens', tu.tokensIn + tu.tokensOut, budget.taskTokens, warnPct, hardMult),
          );
        }

        const worst = worstSignal(candidates);
        if (worst) taskSignals.push(worst);
      }

      // Keep worst per session scope
      const worstSess = worstSignal(sessionSignals);

      return {
        task: taskSignals.length > 0 ? taskSignals : undefined,
        session: worstSess ? [worstSess] : [],
      };
    },

    setBudget(b: CostBudget): void {
      budget = { ...b };
    },

    getBudget(): CostBudget {
      return { ...budget };
    },

    reset(): void {
      _events.length = 0;
      _session = zeroUsage();
      _taskTotals.clear();
      _activeTasks.clear();
      // budget intentionally preserved
    },
  };
}
