/**
 * Generic retry / backoff / timeout / jitter wrapper.
 *
 * Inject `setTimer`, `clearTimer`, `rng`, and `clock` for deterministic tests.
 * No external dependencies.
 */
export interface RetryPolicy {
    /** Maximum total attempts (default 3). */
    maxAttempts?: number;
    /** Base delay in ms (default 200). */
    baseDelayMs?: number;
    /** Upper cap on computed delay before jitter (default 10_000). */
    maxDelayMs?: number;
    /** Delay growth strategy (default 'exponential'). */
    backoff?: 'exponential' | 'linear' | 'fixed';
    /** Jitter strategy (default 'full'). */
    jitter?: 'none' | 'full' | 'equal';
    /**
     * Return true to retry after this error.
     * Called *before* the delay is applied.
     * Default: always retry.
     */
    retryOn?: (err: unknown, attempt: number) => boolean;
    /** Per-attempt timeout in ms; undefined = no timeout. */
    timeoutMs?: number;
    /** Called after each attempt (including the final one). */
    onAttempt?: (info: {
        attempt: number;
        err?: unknown;
        delayMs?: number;
    }) => void;
    /** Abort the entire retry loop immediately when signalled. */
    signal?: AbortSignal;
    /** Timestamp source (default Date.now). */
    clock?: () => number;
    /** Timer factory (default globalThis.setTimeout). */
    setTimer?: (cb: () => void, ms: number) => unknown;
    /** Timer canceller (default globalThis.clearTimeout). */
    clearTimer?: (h: unknown) => void;
    /** Random-number source in [0, 1) (default Math.random). */
    rng?: () => number;
}
export type RetryResult<T> = {
    ok: true;
    value: T;
    attempts: number;
} | {
    ok: false;
    error: unknown;
    attempts: number;
};
export declare function withRetry<T>(fn: (attempt: number, signal?: AbortSignal) => Promise<T>, policy?: RetryPolicy): Promise<T>;
export declare function tryRetry<T>(fn: (attempt: number, signal?: AbortSignal) => Promise<T>, policy?: RetryPolicy): Promise<RetryResult<T>>;
export declare function makeRetryWrapper(defaults: RetryPolicy): <T>(fn: (attempt: number, signal?: AbortSignal) => Promise<T>, policy?: RetryPolicy) => Promise<T>;
//# sourceMappingURL=retry-policy.d.ts.map