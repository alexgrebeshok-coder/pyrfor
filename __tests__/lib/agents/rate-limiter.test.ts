import { describe, expect, it, vi } from "vitest";
import {
  AgentRateLimiter,
  configureRateLimiterStore,
  rateLimiter,
  type RateLimitStore,
} from "@/lib/agents/rate-limiter";

describe("AgentRateLimiter", () => {
  it("allows requests below the configured limit", () => {
    const limiter = new AgentRateLimiter();
    limiter.setLimit("test", { maxRequests: 3, windowMs: 60_000 });
    expect(limiter.canRequest("test")).toBe(true);
    expect(limiter.canRequest("test")).toBe(true);
    expect(limiter.canRequest("test")).toBe(true);
  });

  it("blocks once the burst budget is exhausted", () => {
    const limiter = new AgentRateLimiter();
    limiter.setLimit("bursty", { maxRequests: 2, windowMs: 60_000 });
    expect(limiter.canRequest("bursty")).toBe(true);
    expect(limiter.canRequest("bursty")).toBe(true);
    expect(limiter.canRequest("bursty")).toBe(false);
  });

  it("reports 0 wait time for unknown providers", () => {
    const limiter = new AgentRateLimiter();
    expect(limiter.getWaitTime("never-seen")).toBe(0);
  });

  it("allows requests with unlimited (unknown) providers", () => {
    const limiter = new AgentRateLimiter();
    expect(limiter.canRequest("unknown-provider")).toBe(true);
  });

  it("getWaitTime is positive after a burst is exhausted", () => {
    const limiter = new AgentRateLimiter();
    limiter.setLimit("wt", { maxRequests: 1, windowMs: 60_000 });
    limiter.canRequest("wt");
    const wait = limiter.getWaitTime("wt");
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60_000);
  });

  it("exposes a singleton with sensible defaults", () => {
    expect(rateLimiter).toBeInstanceOf(AgentRateLimiter);
    // Default providers ship with non-zero limits; touching them should be allowed initially.
    expect(rateLimiter.canRequest("openrouter")).toBe(true);
  });

  describe("pluggable store (async API)", () => {
    function makeFakeStore(
      handler: (key: string, windowMs: number) => {
        count: number;
        ttlMs: number;
      }
    ): RateLimitStore & { calls: Array<{ key: string; windowMs: number }> } {
      const calls: Array<{ key: string; windowMs: number }> = [];
      return {
        calls,
        async incrementWindow(key, windowMs) {
          calls.push({ key, windowMs });
          return handler(key, windowMs);
        },
      };
    }

    it("delegates to the configured store and returns allowed=true under limit", async () => {
      const limiter = new AgentRateLimiter();
      limiter.setLimit("openai", { maxRequests: 3, windowMs: 60_000 });
      const store = makeFakeStore(() => ({ count: 1, ttlMs: 55_000 }));
      limiter.setStore(store);

      const result = await limiter.canRequestAsync("openai");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.waitTimeMs).toBe(0);
      expect(store.calls).toHaveLength(1);
      expect(store.calls[0].key).toContain("openai");
      expect(store.calls[0].windowMs).toBe(60_000);
    });

    it("flags the request as not allowed when store count exceeds limit", async () => {
      const limiter = new AgentRateLimiter();
      limiter.setLimit("openai", { maxRequests: 2, windowMs: 60_000 });
      const store = makeFakeStore(() => ({ count: 3, ttlMs: 42_000 }));
      limiter.setStore(store);

      const result = await limiter.canRequestAsync("openai");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.waitTimeMs).toBe(42_000);
    });

    it("falls back to in-process path when the store throws", async () => {
      const limiter = new AgentRateLimiter();
      limiter.setLimit("openai", { maxRequests: 5, windowMs: 60_000 });
      limiter.setStore({
        async incrementWindow() {
          throw new Error("redis down");
        },
      });

      const result = await limiter.canRequestAsync("openai");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.waitTimeMs).toBe(0);
    });

    it("returns allowed=true with no store for unknown providers", async () => {
      const limiter = new AgentRateLimiter();
      const result = await limiter.canRequestAsync("nope");
      expect(result.allowed).toBe(true);
      expect(result.waitTimeMs).toBe(0);
    });

    it("uses a namespaced key when `keyPrefix` is configured", async () => {
      const spy = vi.fn().mockResolvedValue({ count: 1, ttlMs: 1000 });
      const limiter = new AgentRateLimiter({
        store: { incrementWindow: spy },
        keyPrefix: "custom:prefix",
      });
      limiter.setLimit("openai", { maxRequests: 5, windowMs: 30_000 });
      await limiter.canRequestAsync("openai");
      expect(spy).toHaveBeenCalledWith("custom:prefix:openai", 30_000);
    });

    it("configureRateLimiterStore wires the singleton", () => {
      const store = makeFakeStore(() => ({ count: 0, ttlMs: 0 }));
      expect(rateLimiter.getStore()).toBeNull();
      configureRateLimiterStore(store);
      expect(rateLimiter.getStore()).toBe(store);
      configureRateLimiterStore(null);
      expect(rateLimiter.getStore()).toBeNull();
    });
  });
});
