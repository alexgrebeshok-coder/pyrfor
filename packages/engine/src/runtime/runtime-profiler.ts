/**
 * runtime-profiler.ts — Pyrfor: lightweight per-stage latency + counter tracker.
 *
 * Pure TS, ESM only. No native dependencies.
 * Uses fs/promises (appendFile, mkdir) for optional JSONL trace output only.
 *
 * Design decisions:
 *  - quantile: nearest-rank via ceil(q * n) - 1, q clamped to [0,1]
 *  - ring trim: after push, splice oldest from head when length > ringSize
 *  - flush queue: linear append; _doFlush drains atomically via splice(0, n)
 *  - concurrent flush: _inflight var; second await reuses in-flight promise
 *  - negative duration: coerced to 0 (non-negative guarantee)
 *  - NaN / ±Infinity: logged as warn, sample skipped
 *  - end() called twice: records two samples (both durations captured)
 */

import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ProfilerSample {
  stage: string;
  durationMs: number;
  ts: string;
  meta?: Record<string, unknown>;
}

export interface StageStats {
  stage: string;
  count: number;
  totalMs: number;
  meanMs: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  minMs: number;
}

export interface ProfilerSnapshot {
  generatedAt: string;
  /** how far back (ms) samples were considered */
  windowMs: number;
  stages: StageStats[];
  counters: Record<string, number>;
}

export interface CreateRuntimeProfilerOptions {
  /** per-stage sample ring buffer size; default 500 */
  ringSize?: number;
  /** JSONL trace dump file path */
  tracePath?: string;
  /** debounce before writing trace; default 500 ms */
  flushDebounceMs?: number;
  /** snapshot window; default 5 * 60 * 1000 ms */
  windowMs?: number;
  /** injectable clock for tests; default Date.now */
  clock?: () => number;
  logger?: (l: 'info' | 'warn' | 'error', m: string, meta?: unknown) => void;
}

export interface RuntimeProfiler {
  /**
   * Begin timing `stage`. Returns a token with `.end()`.
   * Calling `.end()` twice records two samples — both durations are valid.
   */
  start(
    stage: string,
    meta?: Record<string, unknown>,
  ): { end: (extraMeta?: Record<string, unknown>) => number };

  /**
   * Record a pre-computed duration. Negative values are coerced to 0.
   * NaN / non-finite values are logged as warn and skipped.
   */
  record(stage: string, durationMs: number, meta?: Record<string, unknown>): void;

  /** Increment counter by delta (default 1). Negative delta allowed. Returns new value. */
  count(name: string, delta?: number): number;

  /** Returns counter value, or 0 if never set. */
  getCount(name: string): number;

  /** Clear one counter (by name) or all counters (no argument). */
  resetCount(name?: string): void;

  /** Compute per-stage histogram stats over the rolling window. */
  snapshot(opts?: { windowMs?: number; stage?: string }): ProfilerSnapshot;

  /**
   * Return samples sorted chronologically ascending.
   * `opts.limit` → last N; `opts.sinceMs` → absolute epoch ms lower bound.
   */
  list(stage?: string, opts?: { limit?: number; sinceMs?: number }): ProfilerSample[];

  /** Drop samples for one stage or all stages. Counters are unaffected. */
  clear(stage?: string): void;

  /**
   * Flush pending trace samples to tracePath as JSONL.
   * No-op if tracePath was not configured.
   * Concurrent calls reuse the in-flight promise — no duplicate writes.
   */
  flush(): Promise<void>;
}

// ── quantile ──────────────────────────────────────────────────────────────────

/**
 * Nearest-rank quantile. q is clamped to [0, 1].
 * Returns 0 for empty arrays.
 *
 * Formula: idx = ceil(q * n) - 1 (0-indexed, clamped to [0, n-1]).
 * Example: [10,20,30,40] q=0.5 → ceil(0.5*4)-1 = 1 → sorted[1] = 20.
 */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, q));
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(clamped * sorted.length) - 1));
  return sorted[idx];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_RING_SIZE = 500;
const DEFAULT_FLUSH_DEBOUNCE_MS = 500;
const DEFAULT_WINDOW_MS = 5 * 60 * 1_000;

// ── createRuntimeProfiler ─────────────────────────────────────────────────────

export function createRuntimeProfiler(opts?: CreateRuntimeProfilerOptions): RuntimeProfiler {
  const ringSize = opts?.ringSize ?? DEFAULT_RING_SIZE;
  const tracePath = opts?.tracePath;
  const flushDebounceMs = opts?.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
  const defaultWindowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const clock = opts?.clock ?? (() => Date.now());
  const logger = opts?.logger;

  // ── Internal state ────────────────────────────────────────────────────────

  const _samples = new Map<string, ProfilerSample[]>();
  const _counters = new Map<string, number>();

  // Pending samples to be written to tracePath on next flush
  const _flushQueue: ProfilerSample[] = [];
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _inflight: Promise<void> | null = null;

  // ── Private helpers ───────────────────────────────────────────────────────

  function getBucket(stage: string): ProfilerSample[] {
    let bucket = _samples.get(stage);
    if (!bucket) {
      bucket = [];
      _samples.set(stage, bucket);
    }
    return bucket;
  }

  async function _doFlush(): Promise<void> {
    if (!tracePath || _flushQueue.length === 0) return;

    // Drain atomically (synchronous splice) so no concurrent writer sees same items
    const items = _flushQueue.splice(0, _flushQueue.length);
    if (items.length === 0) return;

    const lines = items.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await mkdir(path.dirname(tracePath), { recursive: true });
    await appendFile(tracePath, lines, 'utf8');
  }

  function flush(): Promise<void> {
    if (!tracePath) return Promise.resolve();
    if (_inflight !== null) return _inflight;

    const p: Promise<void> = _doFlush().finally(() => {
      if ((_inflight as Promise<void>) === p) _inflight = null;
    });
    _inflight = p;
    return p;
  }

  function scheduleFlush(): void {
    if (!tracePath) return;
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      flush().catch((err) => {
        logger?.('error', 'runtime-profiler: flush error', { err });
      });
    }, flushDebounceMs);
  }

  // ── record ────────────────────────────────────────────────────────────────

  function record(stage: string, durationMs: number, meta?: Record<string, unknown>): void {
    const dur = Number(durationMs);
    if (!isFinite(dur)) {
      logger?.('warn', `runtime-profiler: non-finite durationMs skipped for stage "${stage}"`, {
        durationMs,
      });
      return;
    }

    const coerced = Math.max(0, dur);

    const sample: ProfilerSample = {
      stage,
      durationMs: coerced,
      ts: new Date(clock()).toISOString(),
      ...(meta !== undefined ? { meta } : {}),
    };

    const bucket = getBucket(stage);
    bucket.push(sample);

    // Ring: trim oldest when over cap
    if (bucket.length > ringSize) {
      bucket.splice(0, bucket.length - ringSize);
    }

    if (tracePath) {
      _flushQueue.push(sample);
      scheduleFlush();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    start(stage: string, meta?: Record<string, unknown>) {
      const t0 = clock();
      return {
        end(extraMeta?: Record<string, unknown>): number {
          const dur = clock() - t0;
          const merged =
            meta !== undefined || extraMeta !== undefined
              ? { ...meta, ...extraMeta }
              : undefined;
          record(stage, dur, merged);
          return dur;
        },
      };
    },

    record,

    count(name: string, delta = 1): number {
      const next = (_counters.get(name) ?? 0) + delta;
      _counters.set(name, next);
      return next;
    },

    getCount(name: string): number {
      return _counters.get(name) ?? 0;
    },

    resetCount(name?: string): void {
      if (name !== undefined) {
        _counters.delete(name);
      } else {
        _counters.clear();
      }
    },

    snapshot(opts?: { windowMs?: number; stage?: string }): ProfilerSnapshot {
      const winMs = opts?.windowMs ?? defaultWindowMs;
      const now = clock();
      const windowStart = now - winMs;

      const countersObj: Record<string, number> = {};
      for (const [k, v] of _counters) {
        countersObj[k] = v;
      }

      const stagesData: StageStats[] = [];
      const stagesToProcess = opts?.stage
        ? _samples.has(opts.stage) ? [opts.stage] : []
        : Array.from(_samples.keys());

      for (const stage of stagesToProcess) {
        const bucket = _samples.get(stage) ?? [];
        const filtered = bucket.filter(
          (s) => new Date(s.ts).getTime() >= windowStart,
        );
        if (filtered.length === 0) continue;

        const durations = filtered.map((s) => s.durationMs);
        const total = durations.reduce((a, b) => a + b, 0);
        const count = filtered.length;

        stagesData.push({
          stage,
          count,
          totalMs: total,
          meanMs: total / count,
          p50: quantile(durations, 0.5),
          p95: quantile(durations, 0.95),
          p99: quantile(durations, 0.99),
          maxMs: Math.max(...durations),
          minMs: Math.min(...durations),
        });
      }

      return {
        generatedAt: new Date(now).toISOString(),
        windowMs: winMs,
        stages: stagesData,
        counters: countersObj,
      };
    },

    list(stage?: string, opts?: { limit?: number; sinceMs?: number }): ProfilerSample[] {
      let result: ProfilerSample[];

      if (stage !== undefined) {
        result = (_samples.get(stage) ?? []).slice();
      } else {
        result = [];
        for (const bucket of _samples.values()) {
          result.push(...bucket);
        }
      }

      if (opts?.sinceMs !== undefined) {
        const since = opts.sinceMs;
        result = result.filter((s) => new Date(s.ts).getTime() >= since);
      }

      // Chronological ascending
      result.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      if (opts?.limit !== undefined) {
        result = result.slice(-opts.limit);
      }

      return result;
    },

    clear(stage?: string): void {
      if (stage !== undefined) {
        _samples.delete(stage);
      } else {
        _samples.clear();
      }
    },

    flush,
  };
}
