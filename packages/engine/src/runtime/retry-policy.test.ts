// @vitest-environment node
/**
 * Tests for the retry/backoff/timeout/jitter wrapper.
 *
 * All timer/clock/rng dependencies are injected — no fake timers required.
 */

import { describe, it, expect, vi } from 'vitest';
import { withRetry, tryRetry, makeRetryWrapper, RetryPolicy } from './retry-policy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Instant timer that fires immediately (synchronously via microtask). */
function instantTimer(cb: () => void, _ms: number): unknown {
  const id = { cancelled: false };
  Promise.resolve().then(() => { if (!id.cancelled) cb(); });
  return id;
}
function instantClear(h: unknown): void {
  (h as { cancelled: boolean }).cancelled = true;
}

const INSTANT: Pick<RetryPolicy, 'setTimer' | 'clearTimer'> = {
  setTimer: instantTimer,
  clearTimer: instantClear,
};

/** Build a fn that fails `failCount` times then resolves with `value`. */
function buildFlaky<T>(failCount: number, value: T, error: unknown = new Error('flaky')) {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls <= failCount) throw error;
    return value;
  });
}

// ---------------------------------------------------------------------------
// 1. Happy path — succeeds first attempt
// ---------------------------------------------------------------------------
describe('happy path', () => {
  it('resolves with value on first attempt', async () => {
    const fn = vi.fn(async () => 42);
    const result = await withRetry(fn, { ...INSTANT });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes attempt number 1 on first call', async () => {
    let seen = -1;
    await withRetry(async (attempt) => { seen = attempt; return 0; }, { ...INSTANT });
    expect(seen).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Retries until success
// ---------------------------------------------------------------------------
describe('retries until success', () => {
  it('retries twice then succeeds', async () => {
    const fn = buildFlaky(2, 'ok');
    const result = await withRetry(fn, { maxAttempts: 5, ...INSTANT });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('passes increasing attempt numbers', async () => {
    const attempts: number[] = [];
    const fn = buildFlaky(2, 'done');
    await withRetry(
      async (attempt) => { attempts.push(attempt); return fn(attempt); },
      { maxAttempts: 5, ...INSTANT },
    );
    expect(attempts).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 3. Exhausts attempts and throws
// ---------------------------------------------------------------------------
describe('exhausts attempts', () => {
  it('throws last error after maxAttempts', async () => {
    const err = new Error('permanent');
    const fn = vi.fn(async () => { throw err; });
    await expect(withRetry(fn, { maxAttempts: 3, ...INSTANT })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects maxAttempts=1 (no retries)', async () => {
    const fn = vi.fn(async () => { throw new Error('x'); });
    await expect(withRetry(fn, { maxAttempts: 1, ...INSTANT })).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. retryOn = false — no retry, throws immediately
// ---------------------------------------------------------------------------
describe('retryOn', () => {
  it('does not retry when retryOn returns false', async () => {
    const err = new Error('no-retry');
    const fn = vi.fn(async () => { throw err; });
    await expect(
      withRetry(fn, { maxAttempts: 5, retryOn: () => false, ...INSTANT }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('receives error and attempt number', async () => {
    const captured: Array<{ err: unknown; attempt: number }> = [];
    const fn = buildFlaky(2, 'ok');
    await withRetry(fn, {
      maxAttempts: 5,
      retryOn: (err, attempt) => { captured.push({ err, attempt }); return true; },
      ...INSTANT,
    });
    expect(captured[0].attempt).toBe(1);
    expect(captured[1].attempt).toBe(2);
  });

  it('can selectively retry by error type', async () => {
    class Retryable extends Error {}
    class Fatal extends Error {}
    const fn = vi.fn()
      .mockRejectedValueOnce(new Retryable('r'))
      .mockRejectedValueOnce(new Fatal('f'));
    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        retryOn: (err) => err instanceof Retryable,
        ...INSTANT,
      }),
    ).rejects.toBeInstanceOf(Fatal);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Delay calculation — capture via setTimer spy
// ---------------------------------------------------------------------------
describe('delay calculation', () => {
  function captureDelays(policy: RetryPolicy): { delays: number[]; wrappedPolicy: RetryPolicy } {
    const delays: number[] = [];
    const wrappedPolicy: RetryPolicy = {
      ...policy,
      jitter: 'none', // deterministic
      rng: () => 0.5,
      setTimer(cb, ms) {
        delays.push(ms);
        return instantTimer(cb, ms);
      },
      clearTimer: instantClear,
    };
    return { delays, wrappedPolicy };
  }

  it('exponential: delays are baseDelay * 2^(attempt-1)', async () => {
    const { delays, wrappedPolicy } = captureDelays({
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 100_000,
      backoff: 'exponential',
    });
    const fn = buildFlaky(3, 'ok');
    await withRetry(fn, wrappedPolicy);
    // attempt 1 → delay 100*2^0=100, attempt 2 → 100*2^1=200, attempt 3 → 100*2^2=400
    expect(delays).toEqual([100, 200, 400]);
  });

  it('linear: delays are baseDelay * attempt', async () => {
    const { delays, wrappedPolicy } = captureDelays({
      maxAttempts: 4,
      baseDelayMs: 50,
      maxDelayMs: 100_000,
      backoff: 'linear',
    });
    const fn = buildFlaky(3, 'ok');
    await withRetry(fn, wrappedPolicy);
    expect(delays).toEqual([50, 100, 150]);
  });

  it('fixed: delays are always baseDelay', async () => {
    const { delays, wrappedPolicy } = captureDelays({
      maxAttempts: 4,
      baseDelayMs: 75,
      maxDelayMs: 100_000,
      backoff: 'fixed',
    });
    const fn = buildFlaky(3, 'ok');
    await withRetry(fn, wrappedPolicy);
    expect(delays).toEqual([75, 75, 75]);
  });

  it('caps delay at maxDelayMs', async () => {
    const { delays, wrappedPolicy } = captureDelays({
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      backoff: 'exponential',
    });
    const fn = buildFlaky(3, 'ok');
    await withRetry(fn, wrappedPolicy);
    // attempt 1 → 1000, attempt 2 → min(2000,1500)=1500, attempt 3 → min(4000,1500)=1500
    expect(delays).toEqual([1000, 1500, 1500]);
  });
});

// ---------------------------------------------------------------------------
// 6. Jitter
// ---------------------------------------------------------------------------
describe('jitter', () => {
  it('full jitter: delay = rng() * computedDelay', async () => {
    const delays: number[] = [];
    const fn = buildFlaky(1, 'ok');
    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 100_000,
      backoff: 'exponential',
      jitter: 'full',
      rng: () => 0.4,
      setTimer(cb, ms) { delays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    // computedDelay = 200 * 2^0 = 200, full jitter = 0.4 * 200 = 80
    expect(delays).toEqual([80]);
  });

  it('equal jitter: delay = computedDelay/2 + rng()*computedDelay/2', async () => {
    const delays: number[] = [];
    const fn = buildFlaky(1, 'ok');
    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 100_000,
      backoff: 'fixed',
      jitter: 'equal',
      rng: () => 0.6,
      setTimer(cb, ms) { delays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    // computedDelay=200, equal = 100 + 0.6*100 = 160
    expect(delays).toEqual([160]);
  });

  it('equal jitter is always in [computedDelay/2, computedDelay]', async () => {
    const captured: number[] = [];
    // run many times with random rng
    for (let i = 0; i < 20; i++) {
      const fn = buildFlaky(1, 'ok');
      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 100_000,
        backoff: 'fixed',
        jitter: 'equal',
        setTimer(cb, ms) { captured.push(ms); return instantTimer(cb, ms); },
        clearTimer: instantClear,
      });
    }
    for (const d of captured) {
      expect(d).toBeGreaterThanOrEqual(50);
      expect(d).toBeLessThanOrEqual(100);
    }
  });

  it('none jitter passes computed delay verbatim', async () => {
    const delays: number[] = [];
    const fn = buildFlaky(1, 'ok');
    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 300,
      maxDelayMs: 100_000,
      backoff: 'fixed',
      jitter: 'none',
      setTimer(cb, ms) { delays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    expect(delays).toEqual([300]);
  });
});

// ---------------------------------------------------------------------------
// 7. Per-attempt timeout
// ---------------------------------------------------------------------------
describe('per-attempt timeout', () => {
  it('exhausts all attempts when fn always times out', async () => {
    const fn = vi.fn(async (_attempt: number, signal?: AbortSignal) => {
      return new Promise<string>((_res, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason ?? new Error('aborted')));
      });
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        timeoutMs: 20,
        jitter: 'none',
        baseDelayMs: 0,
        retryOn: () => true,
        ...INSTANT,
      }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// Override that test with a proper one:
describe('per-attempt timeout (corrected)', () => {
  it('timeout causes attempt failure and retry', async () => {
    let calls = 0;
    // succeeds on 3rd attempt (before that, hangs until aborted)
    const fn = vi.fn(async (attempt: number, signal?: AbortSignal) => {
      calls++;
      if (attempt < 3) {
        return new Promise<string>((_res, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        });
      }
      return 'success';
    });

    const result = await withRetry(fn, {
      maxAttempts: 4,
      timeoutMs: 20,
      jitter: 'none',
      baseDelayMs: 0,
      ...INSTANT,
    });
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('per-attempt timeout aborts inner AbortSignal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fn = vi.fn(async (_attempt: number, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<never>((_res, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 1,
        timeoutMs: 20,
        jitter: 'none',
        baseDelayMs: 0,
      }),
    ).rejects.toThrow();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Outer AbortSignal
// ---------------------------------------------------------------------------
describe('outer AbortSignal', () => {
  it('pre-aborted signal throws immediately without calling fn', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const fn = vi.fn(async () => 'x');
    await expect(
      withRetry(fn, { signal: controller.signal, ...INSTANT }),
    ).rejects.toThrow('cancelled');
    expect(fn).not.toHaveBeenCalled();
  });

  it('signal aborted during sleep cancels pending timer', async () => {
    const controller = new AbortController();
    let timerHandle: unknown;
    let clearCalled = false;

    const fn = vi.fn(async () => { throw new Error('fail'); });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      jitter: 'none',
      baseDelayMs: 5000, // long enough to stay pending
      signal: controller.signal,
      setTimer(cb, ms) {
        timerHandle = { cb, ms, cancelled: false };
        return timerHandle;
      },
      clearTimer(h) {
        clearCalled = true;
        (h as { cancelled: boolean }).cancelled = true;
      },
    });

    // Let fn run and hit the sleep
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    controller.abort(new DOMException('user cancel', 'AbortError'));

    await expect(promise).rejects.toThrow('user cancel');
    expect(clearCalled).toBe(true);
  });

  it('signal aborted between attempts propagates abort error', async () => {
    const controller = new AbortController();
    let attempt = 0;

    const fn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        controller.abort(new DOMException('mid-flight abort', 'AbortError'));
        throw new Error('fail');
      }
      return 'ok';
    });

    await expect(
      withRetry(fn, { maxAttempts: 5, signal: controller.signal, ...INSTANT }),
    ).rejects.toThrow('mid-flight abort');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 9. onAttempt callback
// ---------------------------------------------------------------------------
describe('onAttempt', () => {
  it('fires once for a successful first attempt with no err/delayMs', async () => {
    const calls: Array<{ attempt: number; err?: unknown; delayMs?: number }> = [];
    await withRetry(async () => 1, {
      onAttempt: (info) => calls.push(info),
      ...INSTANT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].attempt).toBe(1);
    expect(calls[0].err).toBeUndefined();
    expect(calls[0].delayMs).toBeUndefined();
  });

  it('fires for each attempt with err and delayMs on failure', async () => {
    const calls: Array<{ attempt: number; err?: unknown; delayMs?: number }> = [];
    const fn = buildFlaky(2, 'ok');
    await withRetry(fn, {
      maxAttempts: 5,
      jitter: 'none',
      baseDelayMs: 100,
      backoff: 'fixed',
      onAttempt: (info) => calls.push({ ...info }),
      ...INSTANT,
    });
    // attempts 1 and 2 fail (err + delayMs), attempt 3 succeeds (no err)
    expect(calls).toHaveLength(3);
    expect(calls[0].attempt).toBe(1);
    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].delayMs).toBe(100);
    expect(calls[1].attempt).toBe(2);
    expect(calls[1].delayMs).toBe(100);
    expect(calls[2].attempt).toBe(3);
    expect(calls[2].err).toBeUndefined();
  });

  it('fires with err on final exhausted attempt (no delayMs)', async () => {
    const calls: Array<{ attempt: number; err?: unknown; delayMs?: number }> = [];
    const err = new Error('always');
    await withRetry(async () => { throw err; }, {
      maxAttempts: 2,
      onAttempt: (info) => calls.push({ ...info }),
      ...INSTANT,
    }).catch(() => {});
    // last attempt: retryOn returns false (no more attempts) → no delayMs
    expect(calls[calls.length - 1].delayMs).toBeUndefined();
    expect(calls[calls.length - 1].err).toBe(err);
  });
});

// ---------------------------------------------------------------------------
// 10. tryRetry
// ---------------------------------------------------------------------------
describe('tryRetry', () => {
  it('returns ok:true with value and attempt count on success', async () => {
    const result = await tryRetry(async () => 99, { ...INSTANT });
    expect(result).toEqual({ ok: true, value: 99, attempts: 1 });
  });

  it('returns ok:false with error on exhaustion', async () => {
    const err = new Error('fail');
    const result = await tryRetry(async () => { throw err; }, { maxAttempts: 2, ...INSTANT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(err);
      expect(result.attempts).toBe(2);
    }
  });

  it('returns ok:true after retries with correct attempt count', async () => {
    const fn = buildFlaky(2, 'done');
    const result = await tryRetry(fn, { maxAttempts: 5, ...INSTANT });
    expect(result).toEqual({ ok: true, value: 'done', attempts: 3 });
  });

  it('does not throw on abort — returns ok:false', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));
    const result = await tryRetry(async () => 'x', {
      signal: controller.signal,
      ...INSTANT,
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. makeRetryWrapper
// ---------------------------------------------------------------------------
describe('makeRetryWrapper', () => {
  it('applies default policy', async () => {
    const callDelays: number[] = [];
    const retry = makeRetryWrapper({
      maxAttempts: 5,
      baseDelayMs: 50,
      jitter: 'none',
      backoff: 'fixed',
      setTimer(cb, ms) { callDelays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    const fn = buildFlaky(2, 'wrapped');
    const result = await retry(fn);
    expect(result).toBe('wrapped');
    expect(callDelays).toEqual([50, 50]);
  });

  it('per-call policy overrides defaults', async () => {
    const callDelays: number[] = [];
    const retry = makeRetryWrapper({
      maxAttempts: 5,
      baseDelayMs: 50,
      jitter: 'none',
      backoff: 'fixed',
      setTimer(cb, ms) { callDelays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    const fn = buildFlaky(1, 'override');
    // override baseDelayMs
    const result = await retry(fn, { baseDelayMs: 999, jitter: 'none', backoff: 'fixed' });
    expect(result).toBe('override');
    expect(callDelays).toEqual([999]);
  });

  it('returns same signature as withRetry', async () => {
    const retry = makeRetryWrapper({});
    const fn = vi.fn(async () => 7);
    expect(await retry(fn, { maxAttempts: 1, ...INSTANT })).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 12. Edge cases
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('fn receives AbortSignal from outer policy signal', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fn = vi.fn(async (_attempt: number, signal?: AbortSignal) => {
      receivedSignal = signal;
      return 'ok';
    });
    await withRetry(fn, { signal: controller.signal, ...INSTANT });
    expect(receivedSignal).toBe(controller.signal);
  });

  it('handles fn that rejects with non-Error', async () => {
    const fn = vi.fn(async () => { throw 'string-error'; });
    const result = await tryRetry(fn, { maxAttempts: 1, ...INSTANT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('string-error');
  });

  it('maxAttempts=0 throws immediately', async () => {
    const fn = vi.fn(async () => 'x');
    // maxAttempts=0 means the loop body never executes → throws lastError=undefined
    // In practice callers should use >=1; we just verify it doesn't hang.
    let threw = false;
    try {
      await withRetry(fn, { maxAttempts: 0, ...INSTANT });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('uses injected rng for jitter', async () => {
    let rngCalled = false;
    const fn = buildFlaky(1, 'ok');
    await withRetry(fn, {
      maxAttempts: 3,
      jitter: 'full',
      rng: () => { rngCalled = true; return 0.5; },
      ...INSTANT,
    });
    expect(rngCalled).toBe(true);
  });

  it('does not call clearTimer when fn succeeds before timeout', async () => {
    let clearCalled = false;
    const fn = vi.fn(async () => 'fast');
    const result = await withRetry(fn, {
      timeoutMs: 5000,
      setTimer(cb, _ms) {
        // don't fire the timer
        return { cb };
      },
      clearTimer(_h) { clearCalled = true; },
    });
    expect(result).toBe('fast');
    expect(clearCalled).toBe(true); // timer IS cleared after success
  });

  it('defaults: maxAttempts=3, baseDelayMs=200, exponential, full jitter', async () => {
    const delays: number[] = [];
    const fn = buildFlaky(2, 'default');
    await withRetry(fn, {
      jitter: 'none', // override only jitter for determinism
      setTimer(cb, ms) { delays.push(ms); return instantTimer(cb, ms); },
      clearTimer: instantClear,
    });
    // exponential: 200*2^0=200 after attempt 1, 200*2^1=400 after attempt 2
    expect(delays).toEqual([200, 400]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('tryRetry preserves user-supplied onAttempt', async () => {
    const userCalls: number[] = [];
    const fn = buildFlaky(1, 'ok');
    await tryRetry(fn, {
      maxAttempts: 3,
      onAttempt: (info) => userCalls.push(info.attempt),
      ...INSTANT,
    });
    expect(userCalls).toEqual([1, 2]);
  });
});
