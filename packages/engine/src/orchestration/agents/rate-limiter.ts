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
  incrementWindow(
    key: string,
    windowMs: number
  ): Promise<{ count: number; ttlMs: number }>;
}

export class AgentRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private limits: Map<string, RateLimiterConfig> = new Map();
  private store: RateLimitStore | null = null;
  private keyPrefix = "ceoclaw:rl";

  constructor(options: { store?: RateLimitStore; keyPrefix?: string } = {}) {
    this.limits.set("openrouter", { maxRequests: 60, windowMs: 60_000 });
    this.limits.set("zai", { maxRequests: 30, windowMs: 60_000 });
    this.limits.set("openai", { maxRequests: 100, windowMs: 60_000 });
    if (options.store) this.store = options.store;
    if (options.keyPrefix) this.keyPrefix = options.keyPrefix;
  }

  /**
   * Swap the backing store at runtime. Pass `null` to revert to the
   * in-process sliding window (useful for tests / local dev).
   */
  setStore(store: RateLimitStore | null): void {
    this.store = store;
  }

  /** Returns the current store, or `null` when running in-process only. */
  getStore(): RateLimitStore | null {
    return this.store;
  }

  /**
   * Override or register a provider's limit at runtime. Useful for
   * tests and for overriding defaults from env.
   */
  setLimit(provider: string, config: RateLimiterConfig): void {
    this.limits.set(provider, config);
  }

  /**
   * Process-local sliding window. Returns true when the request fits.
   * Continues to work even if an async store is configured, so existing
   * callers don't pay a round-trip on every request.
   */
  canRequest(provider: string): boolean {
    const limit = this.limits.get(provider);
    if (!limit) return true;

    const now = Date.now();
    const requests = this.requests.get(provider) ?? [];
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
  getWaitTime(provider: string): number {
    const limit = this.limits.get(provider);
    if (!limit) return 0;

    const requests = this.requests.get(provider) ?? [];
    if (requests.length === 0) return 0;

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
  async canRequestAsync(provider: string): Promise<RateLimitCheckResult> {
    const limit = this.limits.get(provider);
    if (!limit) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY, waitTimeMs: 0 };
    }

    if (this.store) {
      try {
        const key = `${this.keyPrefix}:${provider}`;
        const { count, ttlMs } = await this.store.incrementWindow(
          key,
          limit.windowMs
        );
        const allowed = count <= limit.maxRequests;
        const remaining = Math.max(0, limit.maxRequests - count);
        const waitTimeMs = allowed ? 0 : Math.max(0, ttlMs);
        return { allowed, remaining, waitTimeMs };
      } catch {
        // fall through to in-process path
      }
    }

    const allowed = this.canRequest(provider);
    const waitTimeMs = allowed ? 0 : this.getWaitTime(provider);
    const requests = this.requests.get(provider) ?? [];
    const remaining = Math.max(0, limit.maxRequests - requests.length);
    return { allowed, remaining, waitTimeMs };
  }

  /**
   * Async variant of `getWaitTime`. Uses the store only when
   * configured; the store value is best-effort and degrades to the
   * in-process read on any error.
   */
  async getWaitTimeAsync(provider: string): Promise<number> {
    if (!this.store) return this.getWaitTime(provider);

    const limit = this.limits.get(provider);
    if (!limit) return 0;

    try {
      const key = `${this.keyPrefix}:${provider}`;
      const { count, ttlMs } = await this.store.incrementWindow(
        key,
        limit.windowMs
      );
      // We only want to *peek* — the increment above will however count
      // against the window. Tolerate that for operator UI calls; hot
      // paths should use `canRequestAsync` which is authoritative.
      if (count <= limit.maxRequests) return 0;
      return Math.max(0, ttlMs);
    } catch {
      return this.getWaitTime(provider);
    }
  }
}

export const rateLimiter = new AgentRateLimiter();

/**
 * Attach (or detach) a shared-state store for the default singleton.
 * Call this from `instrumentation.ts` once the app has loaded its
 * Redis/Upstash credentials.
 */
export function configureRateLimiterStore(store: RateLimitStore | null): void {
  rateLimiter.setStore(store);
}
