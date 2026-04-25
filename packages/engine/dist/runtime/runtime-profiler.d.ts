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
    start(stage: string, meta?: Record<string, unknown>): {
        end: (extraMeta?: Record<string, unknown>) => number;
    };
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
    snapshot(opts?: {
        windowMs?: number;
        stage?: string;
    }): ProfilerSnapshot;
    /**
     * Return samples sorted chronologically ascending.
     * `opts.limit` → last N; `opts.sinceMs` → absolute epoch ms lower bound.
     */
    list(stage?: string, opts?: {
        limit?: number;
        sinceMs?: number;
    }): ProfilerSample[];
    /** Drop samples for one stage or all stages. Counters are unaffected. */
    clear(stage?: string): void;
    /**
     * Flush pending trace samples to tracePath as JSONL.
     * No-op if tracePath was not configured.
     * Concurrent calls reuse the in-flight promise — no duplicate writes.
     */
    flush(): Promise<void>;
}
/**
 * Nearest-rank quantile. q is clamped to [0, 1].
 * Returns 0 for empty arrays.
 *
 * Formula: idx = ceil(q * n) - 1 (0-indexed, clamped to [0, n-1]).
 * Example: [10,20,30,40] q=0.5 → ceil(0.5*4)-1 = 1 → sorted[1] = 20.
 */
export declare function quantile(values: number[], q: number): number;
export declare function createRuntimeProfiler(opts?: CreateRuntimeProfilerOptions): RuntimeProfiler;
//# sourceMappingURL=runtime-profiler.d.ts.map