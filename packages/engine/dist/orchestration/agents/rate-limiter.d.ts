/**
 * Agent Rate Limiter — sliding-window counter per provider.
 *
 * Two surfaces are exposed:
 *
 *   • Synchronous (`canRequest` / `getWaitTime`) — the original Wave F
 *     API, backed by a process-local `Map`. Safe to call on the hot path
 *     and keeps all existing callers working unchanged.
 *
 *   • Asynchronous (`canRequestAsync` / `getWaitTimeAsync`) — delegates
 *     to a pluggable `RateLimitStore` so a Redis (or Upstash REST)
 *     instance can coordinate the window across multiple Node workers.
 *     If no store is configured it falls back to the in-process path so
 *     the behaviour is identical to the sync API.
 *
 * The store interface is deliberately tiny (a single
 * `incrementWindow` call) so deployers can wire any back-end —
 * `ioredis`, Upstash REST, or a custom fake for tests — without
 * pulling a new dependency into the kernel.
 *
 * Extracted from the retired `lib/agents/agent-improvements.ts` in
 * Wave F; the Redis seam was added in Wave H.
 */
export interface RateLimiterConfig {
    maxRequests: number;
    windowMs: number;
}
export interface RateLimitCheckResult {
    /** True when the caller is still within budget for the window. */
    allowed: boolean;
    /** Remaining requests in the current window (>=0). */
    remaining: number;
    /** Time (ms) until the window frees up, 0 when `allowed === true`. */
    waitTimeMs: number;
}
/**
 * Minimal interface a Redis/Upstash adapter must satisfy. A single
 * method keeps adapters tiny and lets us test with in-memory fakes.
 *
 * Implementations MUST atomically increment a counter for the key and
 * return the resulting count together with the ms-until-expiry so the
 * limiter can compute `waitTimeMs`. When the implementation cannot
 * determine the TTL it may return `windowMs` as an upper bound — the
 * limiter uses it only for UX hints.
 */
export interface RateLimitStore {
    incrementWindow(key: string, windowMs: number): Promise<{
        count: number;
        ttlMs: number;
    }>;
}
export declare class AgentRateLimiter {
    private requests;
    private limits;
    private store;
    private keyPrefix;
    constructor(options?: {
        store?: RateLimitStore;
        keyPrefix?: string;
    });
    /**
     * Swap the backing store at runtime. Pass `null` to revert to the
     * in-process sliding window (useful for tests / local dev).
     */
    setStore(store: RateLimitStore | null): void;
    /** Returns the current store, or `null` when running in-process only. */
    getStore(): RateLimitStore | null;
    /**
     * Override or register a provider's limit at runtime. Useful for
     * tests and for overriding defaults from env.
     */
    setLimit(provider: string, config: RateLimiterConfig): void;
    /**
     * Process-local sliding window. Returns true when the request fits.
     * Continues to work even if an async store is configured, so existing
     * callers don't pay a round-trip on every request.
     */
    canRequest(provider: string): boolean;
    /**
     * Milliseconds until the oldest tracked in-process request expires.
     * Returns 0 when no requests are tracked or the window has elapsed.
     */
    getWaitTime(provider: string): number;
    /**
     * Shared-state check. Delegates to the configured store when
     * present; otherwise mirrors `canRequest` exactly. Never throws —
     * any store error degrades to the in-process path so a flaky Redis
     * can't take the kernel down.
     */
    canRequestAsync(provider: string): Promise<RateLimitCheckResult>;
    /**
     * Async variant of `getWaitTime`. Uses the store only when
     * configured; the store value is best-effort and degrades to the
     * in-process read on any error.
     */
    getWaitTimeAsync(provider: string): Promise<number>;
}
export declare const rateLimiter: AgentRateLimiter;
/**
 * Attach (or detach) a shared-state store for the default singleton.
 * Call this from `instrumentation.ts` once the app has loaded its
 * Redis/Upstash credentials.
 */
export declare function configureRateLimiterStore(store: RateLimitStore | null): void;
//# sourceMappingURL=rate-limiter.d.ts.map