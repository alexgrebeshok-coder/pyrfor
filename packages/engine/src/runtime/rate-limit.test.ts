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
  });
});
