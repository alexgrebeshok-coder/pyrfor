/**
 * circuit-tracker.ts — Multi-key circuit breaker with sliding window failure rate + state machine.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';
export type Outcome = 'success' | 'failure' | 'timeout';

export interface CircuitTrackerOpts {
  failureThreshold?: number;
  successThreshold?: number;
  openMs?: number;
  halfOpenMaxConcurrent?: number;
  windowMs?: number;
  clock?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CanExecuteResult {
  ok: boolean;
  reason?: 'open' | 'half_open_full';
}

export interface StateSnapshot {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt?: number;
  nextRetryAt?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
}

export interface StateChangeEvent {
  key: string;
  from: CircuitState;
  to: CircuitState;
  at: number;
}

export interface CircuitTracker {
  canExecute(key: string): CanExecuteResult;
  record(key: string, outcome: Outcome, opts?: { latencyMs?: number }): void;
  state(key: string): StateSnapshot;
  wrap<T>(key: string, fn: () => Promise<T>): Promise<T>;
  forceOpen(key: string, ms?: number): void;
  forceClose(key: string): void;
  reset(key?: string): void;
  onStateChange(handler: (event: StateChangeEvent) => void): () => void;
  snapshot(): Record<string, StateSnapshot>;
}

// ─── Internal structures ───────────────────────────────────────────────────────

interface WindowEntry {
  outcome: Outcome;
  ts: number;
}

const LATENCY_SAMPLE_SIZE = 100;

interface KeyState {
  state: CircuitState;
  window: WindowEntry[];
  consecutiveSuccesses: number;
  halfOpenInFlight: number;
  openedAt?: number;
  openTimerHandle?: unknown;
  latencySamples: number[];
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, idx)];
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCircuitTracker(opts: CircuitTrackerOpts = {}): CircuitTracker {
  const {
    failureThreshold = 5,
    successThreshold = 2,
    openMs = 30_000,
    halfOpenMaxConcurrent = 1,
    windowMs = 60_000,
    clock = () => Date.now(),
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  const keys = new Map<string, KeyState>();
  const listeners = new Set<(event: StateChangeEvent) => void>();

  function getOrCreate(key: string): KeyState {
    let s = keys.get(key);
    if (!s) {
      s = {
        state: 'closed',
        window: [],
        consecutiveSuccesses: 0,
        halfOpenInFlight: 0,
        latencySamples: [],
      };
      keys.set(key, s);
    }
    return s;
  }

  function emit(key: string, from: CircuitState, to: CircuitState): void {
    const ev: StateChangeEvent = { key, from, to, at: clock() };
    for (const fn of listeners) fn(ev);
  }

  function pruneWindow(s: KeyState): void {
    const cutoff = clock() - windowMs;
    s.window = s.window.filter((e) => e.ts > cutoff);
  }

  function failuresInWindow(s: KeyState): number {
    return s.window.filter((e) => e.outcome === 'failure' || e.outcome === 'timeout').length;
  }

  function tripToOpen(key: string, s: KeyState, duration: number): void {
    const from = s.state;
    if (s.openTimerHandle !== undefined) {
      clearTimer(s.openTimerHandle);
      s.openTimerHandle = undefined;
    }
    s.state = 'open';
    s.consecutiveSuccesses = 0;
    s.halfOpenInFlight = 0;
    s.openedAt = clock();
    s.openTimerHandle = setTimer(() => {
      if (s.state === 'open') {
        const prev = s.state;
        s.state = 'half_open';
        s.consecutiveSuccesses = 0;
        s.halfOpenInFlight = 0;
        emit(key, prev, 'half_open');
      }
    }, duration);
    if (from !== 'open') emit(key, from, 'open');
  }

  // ── canExecute ───────────────────────────────────────────────────────────────

  function canExecute(key: string): CanExecuteResult {
    const s = getOrCreate(key);
    if (s.state === 'open') return { ok: false, reason: 'open' };
    if (s.state === 'half_open' && s.halfOpenInFlight >= halfOpenMaxConcurrent) {
      return { ok: false, reason: 'half_open_full' };
    }
    return { ok: true };
  }

  // ── record ───────────────────────────────────────────────────────────────────

  function record(key: string, outcome: Outcome, opts?: { latencyMs?: number }): void {
    const s = getOrCreate(key);
    const now = clock();

    s.window.push({ outcome, ts: now });
    pruneWindow(s);

    if (opts?.latencyMs !== undefined) {
      s.latencySamples.push(opts.latencyMs);
      if (s.latencySamples.length > LATENCY_SAMPLE_SIZE) {
        s.latencySamples.shift();
      }
    }

    if (s.state === 'half_open') {
      if (s.halfOpenInFlight > 0) s.halfOpenInFlight--;
      if (outcome === 'success') {
        s.consecutiveSuccesses++;
        if (s.consecutiveSuccesses >= successThreshold) {
          const prev = s.state;
          s.state = 'closed';
          s.consecutiveSuccesses = 0;
          s.openedAt = undefined;
          if (s.openTimerHandle !== undefined) {
            clearTimer(s.openTimerHandle);
            s.openTimerHandle = undefined;
          }
          emit(key, prev, 'closed');
        }
      } else {
        tripToOpen(key, s, openMs);
      }
      return;
    }

    if (s.state === 'closed') {
      if (outcome === 'failure' || outcome === 'timeout') {
        const failures = failuresInWindow(s);
        if (failures >= failureThreshold) {
          tripToOpen(key, s, openMs);
        }
      }
    }
  }

  // ── state ────────────────────────────────────────────────────────────────────

  function state(key: string): StateSnapshot {
    const s = getOrCreate(key);
    pruneWindow(s);

    const failures = failuresInWindow(s);
    const successes = s.window.filter((e) => e.outcome === 'success').length;
    const sorted = [...s.latencySamples].sort((a, b) => a - b);
    const p50 = sorted.length > 0 ? percentile(sorted, 50) : undefined;
    const p95 = sorted.length > 0 ? percentile(sorted, 95) : undefined;

    return {
      state: s.state,
      failures,
      successes,
      openedAt: s.openedAt,
      nextRetryAt: s.state === 'open' && s.openedAt !== undefined ? s.openedAt + openMs : undefined,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
    };
  }

  // ── wrap ─────────────────────────────────────────────────────────────────────

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const check = canExecute(key);
    if (!check.ok) throw new Error('circuit_open');

    const s = getOrCreate(key);
    if (s.state === 'half_open') s.halfOpenInFlight++;

    const start = clock();
    try {
      const result = await fn();
      const latencyMs = clock() - start;
      record(key, 'success', { latencyMs });
      return result;
    } catch (err) {
      const latencyMs = clock() - start;
      record(key, 'failure', { latencyMs });
      throw err;
    }
  }

  // ── forceOpen ────────────────────────────────────────────────────────────────

  function forceOpen(key: string, ms?: number): void {
    const s = getOrCreate(key);
    tripToOpen(key, s, ms ?? openMs);
  }

  // ── forceClose ───────────────────────────────────────────────────────────────

  function forceClose(key: string): void {
    const s = getOrCreate(key);
    const from = s.state;
    if (s.openTimerHandle !== undefined) {
      clearTimer(s.openTimerHandle);
      s.openTimerHandle = undefined;
    }
    s.state = 'closed';
    s.consecutiveSuccesses = 0;
    s.halfOpenInFlight = 0;
    s.openedAt = undefined;
    if (from !== 'closed') emit(key, from, 'closed');
  }

  // ── reset ────────────────────────────────────────────────────────────────────

  function reset(key?: string): void {
    if (key !== undefined) {
      const s = keys.get(key);
      if (s) {
        if (s.openTimerHandle !== undefined) {
          clearTimer(s.openTimerHandle);
        }
        keys.delete(key);
      }
    } else {
      for (const s of keys.values()) {
        if (s.openTimerHandle !== undefined) clearTimer(s.openTimerHandle);
      }
      keys.clear();
    }
  }

  // ── onStateChange ─────────────────────────────────────────────────────────────

  function onStateChange(handler: (event: StateChangeEvent) => void): () => void {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  // ── snapshot ─────────────────────────────────────────────────────────────────

  function snapshot(): Record<string, StateSnapshot> {
    const result: Record<string, StateSnapshot> = {};
    for (const key of keys.keys()) {
      result[key] = state(key);
    }
    return result;
  }

  return { canExecute, record, state, wrap, forceOpen, forceClose, reset, onStateChange, snapshot };
}
