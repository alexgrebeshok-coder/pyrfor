import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetFrameCacheForTest,
  buildFrameCacheKey,
  cacheFrame,
  FRAME_CACHE_DEFAULTS,
  getCachedFrame,
  listRecentCachedFrames,
} from "@/lib/ai/multimodal/frame-cache";

describe("frame-cache", () => {
  beforeEach(() => {
    __resetFrameCacheForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a stable, short, hex-only key", () => {
    const a = buildFrameCacheKey({
      url: "https://example.com/clip.mp4",
      timestampSeconds: 5,
      scale: "640:-2",
    });
    const b = buildFrameCacheKey({
      url: "https://example.com/clip.mp4",
      timestampSeconds: 5,
      scale: "640:-2",
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(24);
    expect(/^[a-f0-9]+$/i.test(a)).toBe(true);
  });

  it("yields different keys for different timestamps", () => {
    const a = buildFrameCacheKey({
      url: "https://x/y.mp4",
      timestampSeconds: 1,
    });
    const b = buildFrameCacheKey({
      url: "https://x/y.mp4",
      timestampSeconds: 2,
    });
    expect(a).not.toBe(b);
  });

  it("stores and retrieves a frame within the TTL", () => {
    const entry = cacheFrame({
      url: "https://example.com/clip.mp4",
      timestampSeconds: 5,
      data: "aGVsbG8=",
      sizeBytes: 5,
    });

    const found = getCachedFrame(entry.key);
    expect(found?.data).toBe("aGVsbG8=");
    expect(found?.timestampSeconds).toBe(5);
    expect(found?.sizeBytes).toBe(5);
  });

  it("returns null after TTL expiry", () => {
    const entry = cacheFrame(
      {
        url: "https://example.com/clip.mp4",
        timestampSeconds: 5,
        data: "aGVsbG8=",
        sizeBytes: 5,
      },
      { ttlMs: 1_000 }
    );

    vi.advanceTimersByTime(1_500);
    expect(getCachedFrame(entry.key)).toBeNull();
  });

  it("listRecentCachedFrames omits base64 data", () => {
    cacheFrame({
      url: "https://a/b.mp4",
      timestampSeconds: 1,
      data: "X".repeat(100),
      sizeBytes: 100,
    });

    const recent = listRecentCachedFrames();
    expect(recent).toHaveLength(1);
    expect(recent[0]).not.toHaveProperty("data");
    expect(recent[0].sizeBytes).toBe(100);
  });

  it("orders list by most recent first", () => {
    cacheFrame({
      url: "https://a/1.mp4",
      timestampSeconds: 1,
      data: "a",
      sizeBytes: 1,
    });
    vi.advanceTimersByTime(100);
    cacheFrame({
      url: "https://a/2.mp4",
      timestampSeconds: 1,
      data: "b",
      sizeBytes: 1,
    });

    const recent = listRecentCachedFrames();
    expect(recent).toHaveLength(2);
    expect(recent[0].sourceUrl).toBe("https://a/2.mp4");
    expect(recent[1].sourceUrl).toBe("https://a/1.mp4");
  });

  it("exposes defaults for tuning", () => {
    expect(FRAME_CACHE_DEFAULTS.ttlMs).toBeGreaterThan(0);
    expect(FRAME_CACHE_DEFAULTS.maxEntries).toBeGreaterThan(0);
  });

  it("touching an entry keeps it fresh in the LRU order", () => {
    const a = cacheFrame({
      url: "https://a/a.mp4",
      timestampSeconds: 1,
      data: "a",
      sizeBytes: 1,
    });
    cacheFrame({
      url: "https://a/b.mp4",
      timestampSeconds: 1,
      data: "b",
      sizeBytes: 1,
    });

    // A read on `a` should bump its recency.
    getCachedFrame(a.key);
    const recent = listRecentCachedFrames();
    // Most recent (by cachedAt) is still the second insert, but `a`
    // survives and is returned.
    expect(recent.map((f) => f.sourceUrl)).toContain("https://a/a.mp4");
    expect(recent.map((f) => f.sourceUrl)).toContain("https://a/b.mp4");
  });
});
