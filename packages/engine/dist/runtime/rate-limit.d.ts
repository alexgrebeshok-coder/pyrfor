/**
 * Token-bucket rate limiter — pure, no I/O, no timers.
 *
 * Each key gets its own bucket. Tokens refill continuously based on elapsed
 * wall-clock time measured lazily on each tryConsume call.
 * Buckets idle for more than GC_IDLE_MS are garbage-collected lazily.
 */
interface Bucket {
    tokens: number;
    lastRefillAt: number;
    lastUsedAt: number;
}
export interface RateLimiter {
    tryConsume(key: string, n?: number): {
        allowed: boolean;
        retryAfterMs: number;
    };
    /** Exposed for testing only — do not use in production code. */
    __internalState(): ReadonlyMap<string, Readonly<Bucket>>;
}
export interface RateLimiterOptions {
    capacity: number;
    refillPerSec: number;
}
export declare function createRateLimiter(opts: RateLimiterOptions): RateLimiter;
export {};
//# sourceMappingURL=rate-limit.d.ts.map