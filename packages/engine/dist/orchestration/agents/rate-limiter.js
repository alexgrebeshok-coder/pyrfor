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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class AgentRateLimiter {
    constructor(options = {}) {
        this.requests = new Map();
        this.limits = new Map();
        this.store = null;
        this.keyPrefix = "ceoclaw:rl";
        this.limits.set("openrouter", { maxRequests: 60, windowMs: 60000 });
        this.limits.set("zai", { maxRequests: 30, windowMs: 60000 });
        this.limits.set("openai", { maxRequests: 100, windowMs: 60000 });
        if (options.store)
            this.store = options.store;
        if (options.keyPrefix)
            this.keyPrefix = options.keyPrefix;
    }
    /**
     * Swap the backing store at runtime. Pass `null` to revert to the
     * in-process sliding window (useful for tests / local dev).
     */
    setStore(store) {
        this.store = store;
    }
    /** Returns the current store, or `null` when running in-process only. */
    getStore() {
        return this.store;
    }
    /**
     * Override or register a provider's limit at runtime. Useful for
     * tests and for overriding defaults from env.
     */
    setLimit(provider, config) {
        this.limits.set(provider, config);
    }
    /**
     * Process-local sliding window. Returns true when the request fits.
     * Continues to work even if an async store is configured, so existing
     * callers don't pay a round-trip on every request.
     */
    canRequest(provider) {
        var _a;
        const limit = this.limits.get(provider);
        if (!limit)
            return true;
        const now = Date.now();
        const requests = (_a = this.requests.get(provider)) !== null && _a !== void 0 ? _a : [];
        const recentRequests = requests.filter((time) => now - time < limit.windowMs);
        if (recentRequests.length >= limit.maxRequests) {
            return false;
        }
        recentRequests.push(now);
        this.requests.set(provider, recentRequests);
        return true;
    }
    /**
     * Milliseconds until the oldest tracked in-process request expires.
     * Returns 0 when no requests are tracked or the window has elapsed.
     */
    getWaitTime(provider) {
        var _a;
        const limit = this.limits.get(provider);
        if (!limit)
            return 0;
        const requests = (_a = this.requests.get(provider)) !== null && _a !== void 0 ? _a : [];
        if (requests.length === 0)
            return 0;
        const oldestRequest = Math.min(...requests);
        const waitTime = limit.windowMs - (Date.now() - oldestRequest);
        return Math.max(0, waitTime);
    }
    /**
     * Shared-state check. Delegates to the configured store when
     * present; otherwise mirrors `canRequest` exactly. Never throws —
     * any store error degrades to the in-process path so a flaky Redis
     * can't take the kernel down.
     */
    canRequestAsync(provider) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const limit = this.limits.get(provider);
            if (!limit) {
                return { allowed: true, remaining: Number.POSITIVE_INFINITY, waitTimeMs: 0 };
            }
            if (this.store) {
                try {
                    const key = `${this.keyPrefix}:${provider}`;
                    const { count, ttlMs } = yield this.store.incrementWindow(key, limit.windowMs);
                    const allowed = count <= limit.maxRequests;
                    const remaining = Math.max(0, limit.maxRequests - count);
                    const waitTimeMs = allowed ? 0 : Math.max(0, ttlMs);
                    return { allowed, remaining, waitTimeMs };
                }
                catch (_b) {
                    // fall through to in-process path
                }
            }
            const allowed = this.canRequest(provider);
            const waitTimeMs = allowed ? 0 : this.getWaitTime(provider);
            const requests = (_a = this.requests.get(provider)) !== null && _a !== void 0 ? _a : [];
            const remaining = Math.max(0, limit.maxRequests - requests.length);
            return { allowed, remaining, waitTimeMs };
        });
    }
    /**
     * Async variant of `getWaitTime`. Uses the store only when
     * configured; the store value is best-effort and degrades to the
     * in-process read on any error.
     */
    getWaitTimeAsync(provider) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.store)
                return this.getWaitTime(provider);
            const limit = this.limits.get(provider);
            if (!limit)
                return 0;
            try {
                const key = `${this.keyPrefix}:${provider}`;
                const { count, ttlMs } = yield this.store.incrementWindow(key, limit.windowMs);
                // We only want to *peek* — the increment above will however count
                // against the window. Tolerate that for operator UI calls; hot
                // paths should use `canRequestAsync` which is authoritative.
                if (count <= limit.maxRequests)
                    return 0;
                return Math.max(0, ttlMs);
            }
            catch (_a) {
                return this.getWaitTime(provider);
            }
        });
    }
}
export const rateLimiter = new AgentRateLimiter();
/**
 * Attach (or detach) a shared-state store for the default singleton.
 * Call this from `instrumentation.ts` once the app has loaded its
 * Redis/Upstash credentials.
 */
export function configureRateLimiterStore(store) {
    rateLimiter.setStore(store);
}
