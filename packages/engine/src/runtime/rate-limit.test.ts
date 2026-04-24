// @vitest-environment node
/**
 * Tests for the token-bucket rate limiter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('throws on non-positive capacity', () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: -1, refillPerSec: 1 })).toThrow(RangeError);
  });

  it('throws on non-positive refillPerSec', () => {
    expect(() => createRateLimiter({ capacity: 10, refillPerSec: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: 10, refillPerSec: -5 })).toThrow(RangeError);
  });

  describe('bucket math', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows up to capacity requests and then denies', () => {
      const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 });

      expect(rl.tryConsume('a').allowed).toBe(true);
      expect(rl.tryConsume('a').allowed).toBe(true);
      expect(rl.tryConsume('a').allowed).toBe(true);
      const denied = rl.tryConsume('a');
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    });

    it('returns retryAfterMs = 0 when allowed', () => {
      const rl = createRateLimiter({ capacity: 5, refillPerSec: 1 });
      const result = rl.tryConsume('x');
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    });

    it('refills tokens over time', () => {
      const rl = createRateLimiter({ capacity: 2, refillPerSec: 2 });

      // exhaust bucket
      rl.tryConsume('b');
      rl.tryConsume('b');
      expect(rl.tryConsume('b').allowed).toBe(false);

      // advance 1 second → 2 tokens refilled (equals capacity)
      vi.advanceTimersByTime(1000);
      expect(rl.tryConsume('b').allowed).toBe(true);
      expect(rl.tryConsume('b').allowed).toBe(true);
      expect(rl.tryConsume('b').allowed).toBe(false);
    });

    it('does not refill beyond capacity', () => {
      const rl = createRateLimiter({ capacity: 3, refillPerSec: 10 });

      // Advance a long time without any consumption
      vi.advanceTimersByTime(60_000);
      // Should still only have capacity=3 tokens
      expect(rl.tryConsume('c').allowed).toBe(true);
      expect(rl.tryConsume('c').allowed).toBe(true);
      expect(rl.tryConsume('c').allowed).toBe(true);
      expect(rl.tryConsume('c').allowed).toBe(false);
    });

    it('tracks multiple keys independently', () => {
      const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });

      expect(rl.tryConsume('user-A').allowed).toBe(true);
      expect(rl.tryConsume('user-A').allowed).toBe(false);

      // user-B still has a full bucket
      expect(rl.tryConsume('user-B').allowed).toBe(true);
      expect(rl.tryConsume('user-B').allowed).toBe(false);

      // internal state has two separate keys
      const state = rl.__internalState();
      expect(state.size).toBe(2);
      expect(state.has('user-A')).toBe(true);
      expect(state.has('user-B')).toBe(true);
    });

    it('retryAfterMs reflects time needed to refill deficit', () => {
      const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });

      rl.tryConsume('d'); // consume 1 token
      const { allowed, retryAfterMs } = rl.tryConsume('d');
      expect(allowed).toBe(false);
      // deficit = 1 token, refill = 1/sec → ~1000 ms
      expect(retryAfterMs).toBeGreaterThanOrEqual(1000);
      expect(retryAfterMs).toBeLessThanOrEqual(1001);
    });

    it('garbage-collects buckets idle > 5 minutes', () => {
      const rl = createRateLimiter({ capacity: 5, refillPerSec: 1 });

      rl.tryConsume('stale-key');
      expect(rl.__internalState().has('stale-key')).toBe(true);

      // Advance past the 5-minute GC threshold
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      // Trigger GC by consuming on any key
      rl.tryConsume('trigger-gc');
      expect(rl.__internalState().has('stale-key')).toBe(false);
    });

    it('does not GC buckets that are still active', () => {
      const rl = createRateLimiter({ capacity: 5, refillPerSec: 1 });

      rl.tryConsume('active');
      vi.advanceTimersByTime(4 * 60 * 1000); // 4 min — under threshold
      rl.tryConsume('active'); // refresh lastUsedAt
      vi.advanceTimersByTime(2 * 60 * 1000); // 6 min total, but last use was 2 min ago
      rl.tryConsume('other'); // trigger GC pass
      expect(rl.__internalState().has('active')).toBe(true);
    });

    it('GC-ed bucket is recreated fresh (full capacity) on next access', () => {
      const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 });

      // drain the bucket
      rl.tryConsume('revived');
      rl.tryConsume('revived');
      rl.tryConsume('revived');
      expect(rl.tryConsume('revived').allowed).toBe(false);

      // idle past the GC window; trigger GC via another key
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      rl.tryConsume('gc-trigger');
      expect(rl.__internalState().has('revived')).toBe(false);

      // next access for the same key creates a brand-new full bucket
      expect(rl.tryConsume('revived').allowed).toBe(true);
      expect(rl.tryConsume('revived').allowed).toBe(true);
      expect(rl.tryConsume('revived').allowed).toBe(true);
      expect(rl.tryConsume('revived').allowed).toBe(false);
    });

    it('burst then gradual refill: one token per second at refillPerSec=1', () => {
      const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 });

      // exhaust all 3 tokens
      rl.tryConsume('grad');
      rl.tryConsume('grad');
      rl.tryConsume('grad');
      expect(rl.tryConsume('grad').allowed).toBe(false);

      // each 1-second advance restores exactly one token
      vi.advanceTimersByTime(1000);
      expect(rl.tryConsume('grad').allowed).toBe(true);
      expect(rl.tryConsume('grad').allowed).toBe(false);

      vi.advanceTimersByTime(1000);
      expect(rl.tryConsume('grad').allowed).toBe(true);
      expect(rl.tryConsume('grad').allowed).toBe(false);
    });

    it('partial advance yields fractional token accumulation', () => {
      const rl = createRateLimiter({ capacity: 10, refillPerSec: 2 });

      // drain to 0
      for (let i = 0; i < 10; i++) rl.tryConsume('frac');
      expect(rl.tryConsume('frac').allowed).toBe(false);

      // 500 ms → 2 * 0.5 = 1 token
      vi.advanceTimersByTime(500);
      expect(rl.tryConsume('frac').allowed).toBe(true);
      expect(rl.tryConsume('frac').allowed).toBe(false);
    });

    it('refill cap: very long idle does not accumulate beyond capacity', () => {
      const rl = createRateLimiter({ capacity: 5, refillPerSec: 10 });

      // drain fully
      for (let i = 0; i < 5; i++) rl.tryConsume('cap');

      // idle for 1 hour — would be 36 000 tokens without the cap
      vi.advanceTimersByTime(60 * 60 * 1000);

      // only capacity=5 tokens should be available
      for (let i = 0; i < 5; i++) {
        expect(rl.tryConsume('cap').allowed).toBe(true);
      }
      expect(rl.tryConsume('cap').allowed).toBe(false);
    });

    it('custom capacity and refillPerSec are respected', () => {
      const rl = createRateLimiter({ capacity: 7, refillPerSec: 3.5 });

      // consume all 7 tokens
      for (let i = 0; i < 7; i++) {
        expect(rl.tryConsume('custom').allowed).toBe(true);
      }
      expect(rl.tryConsume('custom').allowed).toBe(false);

      // 2 seconds → 7 tokens refilled (= capacity); 2.5 would overshoot but cap applies
      vi.advanceTimersByTime(2000);
      for (let i = 0; i < 7; i++) {
        expect(rl.tryConsume('custom').allowed).toBe(true);
      }
      expect(rl.tryConsume('custom').allowed).toBe(false);
    });

    it('very high capacity (10 000) handled without overflow', () => {
      const rl = createRateLimiter({ capacity: 10_000, refillPerSec: 1 });

      for (let i = 0; i < 10_000; i++) {
        expect(rl.tryConsume('big').allowed).toBe(true);
      }
      expect(rl.tryConsume('big').allowed).toBe(false);

      // bucket state should not exceed capacity even after a long idle
      vi.advanceTimersByTime(100 * 60 * 1000); // 100 minutes
      let count = 0;
      while (rl.tryConsume('big').allowed) count++;
      expect(count).toBe(10_000);
    });

    it('tryConsume(n=2) requires two tokens', () => {
      const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 });

      expect(rl.tryConsume('n2', 2).allowed).toBe(true); // costs 2 → 1 remaining
      expect(rl.tryConsume('n2', 2).allowed).toBe(false); // only 1 left
    });

    it('tryConsume n > capacity is always denied with correct retryAfterMs', () => {
      const rl = createRateLimiter({ capacity: 5, refillPerSec: 1 });

      const { allowed, retryAfterMs } = rl.tryConsume('over', 10);
      expect(allowed).toBe(false);
      // deficit = 10 - 5 = 5 tokens at 1/sec → 5000 ms
      expect(retryAfterMs).toBe(5000);
    });

    it('retryAfterMs is within 1 ms of theoretical value', () => {
      const rl = createRateLimiter({ capacity: 4, refillPerSec: 2 });

      // exhaust all 4 tokens
      for (let i = 0; i < 4; i++) rl.tryConsume('precise');

      // request 3 more: deficit = 3, at 2/sec → 1500 ms
      const { allowed, retryAfterMs } = rl.tryConsume('precise', 3);
      expect(allowed).toBe(false);
      expect(retryAfterMs).toBeGreaterThanOrEqual(1500);
      expect(retryAfterMs).toBeLessThanOrEqual(1501);
    });

    it('three independent keys each have their own bucket', () => {
      const rl = createRateLimiter({ capacity: 2, refillPerSec: 1 });

      // exhaust key-A
      rl.tryConsume('key-A');
      rl.tryConsume('key-A');
      expect(rl.tryConsume('key-A').allowed).toBe(false);

      // key-B and key-C are unaffected
      expect(rl.tryConsume('key-B').allowed).toBe(true);
      expect(rl.tryConsume('key-C').allowed).toBe(true);

      // internal state has three separate keys
      const state = rl.__internalState();
      expect(state.size).toBe(3);
    });

    it('concurrent Promise.all on same key: total consumed ≤ capacity', async () => {
      const capacity = 5;
      const rl = createRateLimiter({ capacity, refillPerSec: 1 });

      // JS is single-threaded; Promise.all resolves synchronously for non-async tasks.
      // Verify that even "concurrent" lookups respect the bucket invariant.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => Promise.resolve(rl.tryConsume('concurrent'))),
      );

      const allowed = results.filter(r => r.allowed).length;
      const denied = results.filter(r => !r.allowed).length;
      expect(allowed).toBe(capacity);
      expect(denied).toBe(10 - capacity);
    });
  });

  describe('disabled-limiter and exempt-path patterns', () => {
    // These patterns are enforced at the call-site (e.g., gateway.ts) rather than
    // inside createRateLimiter itself, which has no built-in "enabled" flag.

    it('disabled limiter: null guard passes all requests through', () => {
      // createRateLimiter does not support enabled:false; the caller keeps rateLimiter===null.
      const rateLimiter: ReturnType<typeof createRateLimiter> | null = null;
      const check = (key: string) =>
        rateLimiter ? rateLimiter.tryConsume(key) : ({ allowed: true, retryAfterMs: 0 } as const);

      for (let i = 0; i < 100; i++) {
        expect(check('any-key').allowed).toBe(true);
      }
    });

    it('exempt path: bypassing tryConsume for specific keys allows all through', () => {
      vi.useFakeTimers();
      try {
        const exemptPaths = ['/ping', '/health', '/metrics'];
        // capacity=1 so the second non-exempt call would fail
        const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });
        rl.tryConsume('/api'); // exhaust the bucket

        const check = (path: string) =>
          exemptPaths.includes(path)
            ? { allowed: true, retryAfterMs: 0 }
            : rl.tryConsume(path);

        // non-exempt path is denied (bucket empty)
        expect(check('/api').allowed).toBe(false);

        // exempt paths are never rate-limited
        for (const path of exemptPaths) {
          expect(check(path).allowed).toBe(true);
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
