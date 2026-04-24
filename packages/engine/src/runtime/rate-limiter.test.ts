// @vitest-environment node
/**
 * Tests for RateLimiter — token bucket + sliding window per-key.
 *
 * All timer/clock dependencies are injected — no real timers needed.
 */

import { describe, it, expect } from 'vitest';
import {
  createTokenBucket,
  createSlidingWindow,
  createMultiKeyLimiter,
} from './rate-limiter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake clock + controllable timer for deterministic async tests. */
function makeFakeClock(startMs = 1_000) {
  let now = startMs;
  type Entry = { id: number; fireAt: number; cb: () => void; cancelled: boolean };
  const pending: Entry[] = [];
  let nextId = 1;

  return {
    now: () => now,
    advance(ms: number) { now += ms; },
    setTimer(cb: () => void, ms: number): number {
      const id = nextId++;
      pending.push({ id, fireAt: now + ms, cb, cancelled: false });
      return id;
    },
    clearTimer(h: unknown): void {
      const t = pending.find(e => e.id === (h as number));
      if (t) t.cancelled = true;
    },
    /** Fire all timers whose fireAt ≤ now. */
    tick(): void {
      const due = pending
        .filter(e => !e.cancelled && e.fireAt <= now)
        .sort((a, b) => a.fireAt - b.fireAt);
      for (const t of due) {
        if (!t.cancelled) { t.cancelled = true; t.cb(); }
      }
    },
    /** Fire the single next-soonest timer (advancing clock to it). */
    fireNext(): void {
      const alive = pending.filter(e => !e.cancelled);
      if (!alive.length) return;
      const next = alive.reduce((a, b) => (a.fireAt <= b.fireAt ? a : b));
      now = Math.max(now, next.fireAt);
      next.cancelled = true;
      next.cb();
    },
  };
}

/** Instant timer — fires callback as a microtask (for simpler async tests). */
function instantTimer(cb: () => void, _ms: number): unknown {
  const id = { cancelled: false };
  Promise.resolve().then(() => { if (!id.cancelled) cb(); });
  return id;
}
function instantClear(h: unknown): void {
  (h as { cancelled: boolean }).cancelled = true;
}
const INSTANT = { setTimer: instantTimer, clearTimer: instantClear };

// ===========================================================================
// Token Bucket
// ===========================================================================

describe('createTokenBucket', () => {
  // -------------------------------------------------------------------------
  // Synchronous basics
  // -------------------------------------------------------------------------

  it('starts with full capacity', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    expect(b.available()).toBe(5);
  });

  it('tryConsume(1) is the default', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 3, refillPerSec: 1, clock: fc.now, ...INSTANT });
    expect(b.tryConsume()).toBe(true);
    expect(b.available()).toBeCloseTo(2, 5);
  });

  it('tryConsume reduces available tokens', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 10, refillPerSec: 1, clock: fc.now, ...INSTANT });
    expect(b.tryConsume(4)).toBe(true);
    expect(b.available()).toBeCloseTo(6, 5);
  });

  it('tryConsume returns false when empty', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 2, refillPerSec: 1, clock: fc.now, ...INSTANT });
    b.tryConsume(2);
    expect(b.tryConsume()).toBe(false);
  });

  it('capacity respected — cannot overdraw', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 3, refillPerSec: 1, clock: fc.now, ...INSTANT });
    expect(b.tryConsume(3)).toBe(true);
    expect(b.tryConsume(1)).toBe(false);
  });

  it('tryConsume(n > capacity) always returns false', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 10, clock: fc.now, ...INSTANT });
    expect(b.tryConsume(6)).toBe(false);
    expect(b.tryConsume(100)).toBe(false);
  });

  it('available() refills lazily on read', () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({ capacity: 10, refillPerSec: 2, clock: fc.now, ...INSTANT });
    b.tryConsume(10); // drain
    fc.advance(1_000); // +1 sec → should add 2 tokens
    expect(b.available()).toBeCloseTo(2, 4);
  });

  it('available() caps at capacity', () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({ capacity: 5, refillPerSec: 10, clock: fc.now, ...INSTANT });
    b.tryConsume(5); // drain
    fc.advance(10_000); // way more than needed
    expect(b.available()).toBe(5);
  });

  it('reset() restores full capacity', () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    b.tryConsume(5);
    expect(b.available()).toBeCloseTo(0, 5);
    b.reset();
    expect(b.available()).toBe(5);
  });

  it('reset() resets the refill baseline (no phantom refill)', () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    b.tryConsume(5); // drain at t=1000
    fc.advance(5_000); // t=6000 — would give 5 tokens if old baseline used
    b.reset(); // baseline resets to t=6000
    fc.advance(0); // no additional time
    expect(b.available()).toBe(5); // reset → full, no extra from old baseline
  });

  // -------------------------------------------------------------------------
  // Async consume
  // -------------------------------------------------------------------------

  it('consume resolves immediately when tokens available', async () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    await expect(b.consume(3)).resolves.toBeUndefined();
    expect(b.available()).toBeCloseTo(2, 5);
  });

  it('consume waits and resolves when refilled', async () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({
      capacity: 4,
      refillPerSec: 2, // 2 tokens/sec → need 2s to refill 4
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    b.tryConsume(4); // drain

    const p = b.consume(4);
    fc.advance(2_000); // enough to refill
    fc.tick();

    await expect(p).resolves.toBeUndefined();
  });

  it('consume resolves as soon as enough tokens appear (partial refill)', async () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({
      capacity: 10,
      refillPerSec: 5, // 5 tokens/sec
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    b.tryConsume(10); // drain

    const p = b.consume(5); // need 1s to get 5 tokens
    fc.advance(1_000);
    fc.tick();

    await expect(p).resolves.toBeUndefined();
  });

  it('signal abort rejects with RATE_LIMIT_ABORTED', async () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({
      capacity: 2,
      refillPerSec: 1,
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    b.tryConsume(2); // drain

    const ctrl = new AbortController();
    const p = b.consume(2, { signal: ctrl.signal });
    ctrl.abort();

    await expect(p).rejects.toThrow('RATE_LIMIT_ABORTED');
  });

  it('already-aborted signal rejects immediately', async () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(b.consume(1, { signal: ctrl.signal })).rejects.toThrow('RATE_LIMIT_ABORTED');
  });

  it('timeoutMs rejects with RATE_LIMIT_TIMEOUT', async () => {
    const fc = makeFakeClock(1_000);
    const b = createTokenBucket({
      capacity: 2,
      refillPerSec: 0.1, // slow — 20s to refill 2 tokens
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    b.tryConsume(2); // drain

    const p = b.consume(2, { timeoutMs: 500 });
    fc.advance(500);
    fc.tick(); // fires the timeout

    await expect(p).rejects.toThrow('RATE_LIMIT_TIMEOUT');
  });

  it('consume(n > capacity) rejects immediately', async () => {
    const fc = makeFakeClock();
    const b = createTokenBucket({ capacity: 5, refillPerSec: 1, clock: fc.now, ...INSTANT });
    await expect(b.consume(6)).rejects.toThrow();
  });
});

// ===========================================================================
// Sliding Window
// ===========================================================================

describe('createSlidingWindow', () => {
  it('tryHit accepts up to limit', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 3, windowMs: 1_000, clock: fc.now, ...INSTANT });
    expect(w.tryHit()).toBe(true);
    expect(w.tryHit()).toBe(true);
    expect(w.tryHit()).toBe(true);
    expect(w.tryHit()).toBe(false); // at limit
  });

  it('tryHit returns false when at limit', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 1, windowMs: 500, clock: fc.now, ...INSTANT });
    expect(w.tryHit()).toBe(true);
    expect(w.tryHit()).toBe(false);
  });

  it('drops old entries past windowMs', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 2, windowMs: 100, clock: fc.now, ...INSTANT });
    w.tryHit(); // t=1000
    w.tryHit(); // t=1000 — at limit
    expect(w.tryHit()).toBe(false);

    fc.advance(101); // t=1101: entries at 1000 are expired (1000 <= 1101-100=1001)
    expect(w.tryHit()).toBe(true); // both slots freed
  });

  it('count() returns number of hits in the current window', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 5, windowMs: 200, clock: fc.now, ...INSTANT });
    expect(w.count()).toBe(0);
    w.tryHit();
    w.tryHit();
    expect(w.count()).toBe(2);
  });

  it('count() drops expired entries', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 5, windowMs: 100, clock: fc.now, ...INSTANT });
    w.tryHit(); // t=1000
    w.tryHit(); // t=1000
    fc.advance(101);
    expect(w.count()).toBe(0);
  });

  it('reset() clears all timestamps', () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({ limit: 3, windowMs: 1_000, clock: fc.now, ...INSTANT });
    w.tryHit(); w.tryHit(); w.tryHit();
    expect(w.count()).toBe(3);
    w.reset();
    expect(w.count()).toBe(0);
    expect(w.tryHit()).toBe(true);
  });

  it('hit() resolves immediately when under limit', async () => {
    const fc = makeFakeClock();
    const w = createSlidingWindow({ limit: 3, windowMs: 1_000, clock: fc.now, ...INSTANT });
    await expect(w.hit()).resolves.toBeUndefined();
    expect(w.count()).toBe(1);
  });

  it('hit() async waits and resolves when window clears', async () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({
      limit: 2,
      windowMs: 100,
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    w.tryHit(); // t=1000
    w.tryHit(); // t=1000 — at limit

    const p = w.hit();
    fc.advance(102); // entries at 1000 now expired
    fc.tick();

    await expect(p).resolves.toBeUndefined();
    expect(w.count()).toBe(1);
  });

  it('hit() signal abort rejects RATE_LIMIT_ABORTED', async () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({
      limit: 1,
      windowMs: 1_000,
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    w.tryHit(); // at limit

    const ctrl = new AbortController();
    const p = w.hit({ signal: ctrl.signal });
    ctrl.abort();

    await expect(p).rejects.toThrow('RATE_LIMIT_ABORTED');
  });

  it('hit() timeoutMs rejects RATE_LIMIT_TIMEOUT', async () => {
    const fc = makeFakeClock(1_000);
    const w = createSlidingWindow({
      limit: 1,
      windowMs: 1_000, // 1s window
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    w.tryHit(); // at limit — won't clear for 1000ms

    const p = w.hit({ timeoutMs: 200 });
    fc.advance(200);
    fc.tick();

    await expect(p).rejects.toThrow('RATE_LIMIT_TIMEOUT');
  });

  it('already-aborted signal rejects immediately', async () => {
    const fc = makeFakeClock();
    const w = createSlidingWindow({ limit: 5, windowMs: 1_000, clock: fc.now, ...INSTANT });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(w.hit({ signal: ctrl.signal })).rejects.toThrow('RATE_LIMIT_ABORTED');
  });
});

// ===========================================================================
// Multi-Key Limiter
// ===========================================================================

describe('createMultiKeyLimiter', () => {
  it('independent buckets per key', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 3, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a', 3); // drain a
    expect(lim.available('a')).toBeCloseTo(0, 5);
    expect(lim.available('b')).toBe(3); // b untouched
  });

  it('tryConsume per key respects capacity', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 2, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    expect(lim.tryConsume('x', 2)).toBe(true);
    expect(lim.tryConsume('x', 1)).toBe(false);
    expect(lim.tryConsume('y', 2)).toBe(true); // separate bucket
  });

  it('available() tracks per-key tokens', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 5, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a', 3);
    lim.tryConsume('b', 1);
    expect(lim.available('a')).toBeCloseTo(2, 5);
    expect(lim.available('b')).toBeCloseTo(4, 5);
  });

  it('tryConsume(n > capacity) returns false for any key', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 3, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    expect(lim.tryConsume('z', 4)).toBe(false);
  });

  it('consume(key) async resolves when refilled', async () => {
    const fc = makeFakeClock(1_000);
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 2, refillPerSec: 2 },
      clock: fc.now,
      setTimer: fc.setTimer,
      clearTimer: fc.clearTimer,
    });
    lim.tryConsume('k', 2); // drain

    const p = lim.consume('k', 2);
    fc.advance(1_000); // +2 tokens
    fc.tick();

    await expect(p).resolves.toBeUndefined();
  });

  it('reset(key) clears one key, leaves others intact', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 3, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a', 3);
    lim.tryConsume('b', 2);

    lim.reset('a');
    expect(lim.available('a')).toBe(3);
    expect(lim.available('b')).toBeCloseTo(1, 5);
  });

  it('reset() clears all keys', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 3, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a', 3);
    lim.tryConsume('b', 3);

    lim.reset();
    expect(lim.available('a')).toBe(3);
    expect(lim.available('b')).toBe(3);
  });

  it('keys() returns all active keys', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 5, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('foo');
    lim.tryConsume('bar');
    lim.tryConsume('baz');
    expect(lim.keys().sort()).toEqual(['bar', 'baz', 'foo']);
  });

  it('maxKeys evicts LRU key when exceeded', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 5, refillPerSec: 1 },
      maxKeys: 3,
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a'); // LRU=a
    lim.tryConsume('b');
    lim.tryConsume('c'); // MRU=c
    expect(lim.keys()).toHaveLength(3);

    lim.tryConsume('d'); // evicts 'a'
    const keys = lim.keys();
    expect(keys).toHaveLength(3);
    expect(keys).not.toContain('a');
    expect(keys).toContain('d');
  });

  it('maxKeys LRU access order is respected', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<string>({
      bucket: { capacity: 5, refillPerSec: 1 },
      maxKeys: 3,
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume('a');
    lim.tryConsume('b');
    lim.tryConsume('c');
    // Re-access 'a' → 'b' becomes LRU
    lim.tryConsume('a');
    lim.tryConsume('d'); // should evict 'b'
    const keys = lim.keys();
    expect(keys).not.toContain('b');
    expect(keys).toContain('a');
    expect(keys).toContain('d');
  });

  it('keys() after eviction reflects current state', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<number>({
      bucket: { capacity: 1, refillPerSec: 1 },
      maxKeys: 2,
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume(1);
    lim.tryConsume(2);
    lim.tryConsume(3); // evicts 1
    expect(lim.keys().sort()).toEqual([2, 3]);
  });

  it('numeric keys work independently', () => {
    const fc = makeFakeClock();
    const lim = createMultiKeyLimiter<number>({
      bucket: { capacity: 3, refillPerSec: 1 },
      clock: fc.now, ...INSTANT,
    });
    lim.tryConsume(1, 3);
    expect(lim.tryConsume(1)).toBe(false);
    expect(lim.tryConsume(2)).toBe(true);
  });

  it('window-only config: tryConsume counts hits', () => {
    const fc = makeFakeClock(1_000);
    const lim = createMultiKeyLimiter<string>({
      window: { limit: 2, windowMs: 500 },
      clock: fc.now, ...INSTANT,
    });
    expect(lim.tryConsume('u')).toBe(true);
    expect(lim.tryConsume('u')).toBe(true);
    expect(lim.tryConsume('u')).toBe(false); // at limit

    fc.advance(501); // window expires
    expect(lim.tryConsume('u')).toBe(true);
  });
});
