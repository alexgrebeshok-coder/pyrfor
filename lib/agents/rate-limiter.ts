/**
 * Agent Rate Limiter — simple in-process sliding-window counter per
 * provider. Used at the edge (API routes) to short-circuit obvious
 * burst violations before we hit the AIRouter / circuit breaker chain.
 *
 * NOTE: this is process-local. In a multi-instance deployment it only
 * protects against bursts within one Node worker; a shared Redis
 * implementation is tracked as future work.
 *
 * Extracted from the legacy `lib/agents/agent-improvements.ts` in
 * Wave F to decouple the limiter from the deprecated
 * `ImprovedAgentExecutor`.
 */

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

export class AgentRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private limits: Map<string, RateLimiterConfig> = new Map();

  constructor() {
    this.limits.set("openrouter", { maxRequests: 60, windowMs: 60_000 });
    this.limits.set("zai", { maxRequests: 30, windowMs: 60_000 });
    this.limits.set("openai", { maxRequests: 100, windowMs: 60_000 });
  }

  /**
   * Override or register a provider's limit at runtime. Useful for
   * tests and for overriding defaults from env.
   */
  setLimit(provider: string, config: RateLimiterConfig): void {
    this.limits.set(provider, config);
  }

  /**
   * Returns true if the request is within the sliding-window budget.
   * When allowed, the request timestamp is recorded so subsequent
   * calls see the new burst.
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
   * Milliseconds until the oldest tracked request expires from the
   * window. Returns 0 when no requests are tracked or the window has
   * already elapsed.
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
}

export const rateLimiter = new AgentRateLimiter();
