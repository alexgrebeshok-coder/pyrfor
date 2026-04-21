import { describe, expect, it } from "vitest";
import { AgentRateLimiter, rateLimiter } from "@/lib/agents/rate-limiter";

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
});
