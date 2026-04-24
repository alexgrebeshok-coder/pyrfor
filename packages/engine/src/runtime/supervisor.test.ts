// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  installCrashHandlers,
  runWithRestart,
  SupervisorGiveUpError,
} from './supervisor';

// ---------------------------------------------------------------------------
// installCrashHandlers
// ---------------------------------------------------------------------------

describe('installCrashHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes onCrash and does NOT exit when exitOnCrash=false', async () => {
    const onCrash = vi.fn().mockResolvedValue(undefined);
    const { dispose } = installCrashHandlers({ onCrash, exitOnCrash: false });

    const err = new Error('test-uncaught');
    // Directly emit so the listener fires synchronously-ish; we await a tick.
    process.emit('uncaughtException', err);
    // Allow the async handler microtask to flush.
    await new Promise((r) => setTimeout(r, 10));

    expect(onCrash).toHaveBeenCalledOnce();
    expect(onCrash).toHaveBeenCalledWith(err, 'uncaughtException');

    dispose();
  });

  it('invokes onCrash for unhandledRejection and does NOT exit when exitOnCrash=false', async () => {
    const onCrash = vi.fn().mockResolvedValue(undefined);
    const { dispose } = installCrashHandlers({ onCrash, exitOnCrash: false });

    const reason = new Error('test-rejection');
    // unhandledRejection passes (reason, promise) — handler receives first arg
    process.emit('unhandledRejection', reason, Promise.resolve());
    await new Promise((r) => setTimeout(r, 10));

    expect(onCrash).toHaveBeenCalledOnce();
    expect(onCrash).toHaveBeenCalledWith(reason, 'unhandledRejection');

    dispose();
  });

  it('dispose removes the listeners so listener count drops back to baseline', () => {
    const before = process.listenerCount('uncaughtException');

    const { dispose } = installCrashHandlers({ exitOnCrash: false });

    expect(process.listenerCount('uncaughtException')).toBe(before + 1);

    dispose();

    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('wraps non-Error values in an Error', async () => {
    const onCrash = vi.fn().mockResolvedValue(undefined);
    const { dispose } = installCrashHandlers({ onCrash, exitOnCrash: false });

    process.emit('uncaughtException', 'string-error' as unknown as Error);
    await new Promise((r) => setTimeout(r, 10));

    expect(onCrash).toHaveBeenCalledOnce();
    const [receivedErr] = onCrash.mock.calls[0] as [Error, string];
    expect(receivedErr).toBeInstanceOf(Error);
    expect(receivedErr.message).toBe('string-error');

    dispose();
  });
});

// ---------------------------------------------------------------------------
// runWithRestart
// ---------------------------------------------------------------------------

describe('runWithRestart', () => {
  it('returns value immediately when factory succeeds on first try', async () => {
    const factory = vi.fn().mockResolvedValue(42);
    const result = await runWithRestart({ factory, backoffMs: 1 });
    expect(result).toBe(42);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('retries on failure and returns value after 2 failures', async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('success');

    const result = await runWithRestart({ factory, backoffMs: 1 });
    expect(result).toBe('success');
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('throws SupervisorGiveUpError after maxRestarts failures', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('always-fails'));

    await expect(
      runWithRestart({ factory, maxRestarts: 3, backoffMs: 1 }),
    ).rejects.toBeInstanceOf(SupervisorGiveUpError);

    // 1 initial + 3 restarts = 4 total calls
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('SupervisorGiveUpError carries restarts count and cause', async () => {
    const cause = new Error('root-cause');
    const factory = vi.fn().mockRejectedValue(cause);

    const err = await runWithRestart({ factory, maxRestarts: 2, backoffMs: 1 }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SupervisorGiveUpError);
    const giveUp = err as SupervisorGiveUpError;
    expect(giveUp.restarts).toBe(2);
    expect(giveUp.cause).toBe(cause);
  });

  it('stops early when isCancelled() returns true before a retry', async () => {
    // Fail once, then cancel before retry fires.
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('should-not-reach');

    let cancelled = false;
    // After factory fails we flip the flag synchronously in a small delay.
    const originalSetTimeout = globalThis.setTimeout;
    const cancelSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(
      (fn: TimerHandler, _delay?: number, ..._args: unknown[]) => {
        // Let the real sleep run but flip cancelled before the next attempt check.
        cancelled = true;
        return originalSetTimeout(fn as (...args: unknown[]) => void, 0);
      },
    );

    const err = await runWithRestart({
      factory,
      maxRestarts: 5,
      backoffMs: 1,
      isCancelled: () => cancelled,
    }).catch((e: unknown) => e);

    cancelSpy.mockRestore();

    expect(err).toBeInstanceOf(SupervisorGiveUpError);
    // factory should only have been called once (the initial failed attempt)
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// installCrashHandlers — additional coverage
// ---------------------------------------------------------------------------

describe('installCrashHandlers — exitOnCrash + idempotency', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Prevent the test process from actually exiting.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      return undefined as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls process.exit(1) after onCrash when exitOnCrash=true (default)', async () => {
    const onCrash = vi.fn().mockResolvedValue(undefined);
    const { dispose } = installCrashHandlers({ onCrash }); // exitOnCrash defaults to true

    process.emit('uncaughtException', new Error('boom'));
    await new Promise((r) => setTimeout(r, 20));

    expect(onCrash).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);

    dispose();
  });

  it('calls process.exit(1) even when onCrash callback throws', async () => {
    const onCrash = vi.fn().mockRejectedValue(new Error('callback-blew-up'));
    const { dispose } = installCrashHandlers({ onCrash });

    process.emit('uncaughtException', new Error('primary-error'));
    await new Promise((r) => setTimeout(r, 20));

    // onCrash threw, but exit must still be called
    expect(exitSpy).toHaveBeenCalledWith(1);

    dispose();
  });

  it('is NOT idempotent by design — second call adds a second listener set', () => {
    const before = process.listenerCount('uncaughtException');

    const first = installCrashHandlers({ exitOnCrash: false });
    const second = installCrashHandlers({ exitOnCrash: false });

    // Two independent installs → two extra listeners each
    expect(process.listenerCount('uncaughtException')).toBe(before + 2);

    first.dispose();
    second.dispose();

    // Both disposed → back to baseline
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('attaches listeners for both uncaughtException and unhandledRejection', () => {
    const beforeUE = process.listenerCount('uncaughtException');
    const beforeUR = process.listenerCount('unhandledRejection');

    const { dispose } = installCrashHandlers({ exitOnCrash: false });

    expect(process.listenerCount('uncaughtException')).toBe(beforeUE + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(beforeUR + 1);

    dispose();

    expect(process.listenerCount('uncaughtException')).toBe(beforeUE);
    expect(process.listenerCount('unhandledRejection')).toBe(beforeUR);
  });
});

// ---------------------------------------------------------------------------
// runWithRestart — exponential backoff + backoff cap
// ---------------------------------------------------------------------------

describe('runWithRestart — backoff & edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Spy on setTimeout to capture the delay values that the supervisor passes,
   * but execute the timer immediately (delay=0) so the test doesn't block.
   */
  function captureBackoffDelays(delays: number[]) {
    const realSetTimeout = globalThis.setTimeout;
    return vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        delays.push(delay ?? 0);
        // Run the callback immediately so the retry loop doesn't stall.
        return realSetTimeout(fn, 0, ...args);
      },
    );
  }

  it('applies exponential backoff: 1000 → 2000 → 4000ms for 3 retries', async () => {
    const delays: number[] = [];
    captureBackoffDelays(delays);

    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('f1'))
      .mockRejectedValueOnce(new Error('f2'))
      .mockRejectedValueOnce(new Error('f3'))
      .mockResolvedValue('ok');

    const result = await runWithRestart({ factory, backoffMs: 1000 });

    expect(result).toBe('ok');
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('caps backoff at 30 000 ms regardless of attempt count', async () => {
    const delays: number[] = [];
    captureBackoffDelays(delays);

    // 8 failures → delays: 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000
    const factory = vi.fn().mockRejectedValue(new Error('always'));

    await runWithRestart({ factory, maxRestarts: 8, backoffMs: 1000 }).catch(() => {});

    expect(Math.max(...delays)).toBe(30_000);
    // After the cap is hit the last few delays must all be exactly 30 000.
    const capped = delays.filter((d) => d === 30_000);
    expect(capped.length).toBeGreaterThanOrEqual(1);
    // No delay must ever exceed 30 000 ms.
    expect(delays.every((d) => d <= 30_000)).toBe(true);
  });

  it('maxRestarts=0 means no retries — throws immediately on first failure', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('instant-fail'));

    const err = await runWithRestart({ factory, maxRestarts: 0, backoffMs: 1 }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SupervisorGiveUpError);
    const giveUp = err as SupervisorGiveUpError;
    expect(giveUp.restarts).toBe(0);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('respects a custom maxRestarts value (e.g. 2)', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('fail'));

    await runWithRestart({ factory, maxRestarts: 2, backoffMs: 1 }).catch(() => {});

    // 1 initial + 2 retries = 3 total calls
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('stops loop cleanly when isCancelled() returns true (SIGTERM/abort scenario)', async () => {
    const delays: number[] = [];
    captureBackoffDelays(delays);

    let cancelAfter = 2; // allow first two failures, then signal cancellation
    let factoryCalls = 0;
    const factory = vi.fn().mockImplementation(() => {
      factoryCalls++;
      return Promise.reject(new Error(`fail-${factoryCalls}`));
    });

    const isCancelled = vi.fn().mockImplementation(() => {
      cancelAfter--;
      return cancelAfter < 0;
    });

    const err = await runWithRestart({
      factory,
      maxRestarts: 10,
      backoffMs: 1,
      isCancelled,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SupervisorGiveUpError);
    // Loop must have stopped well before maxRestarts=10
    expect(factory.mock.calls.length).toBeLessThan(10);
    // isCancelled must have been consulted
    expect(isCancelled).toHaveBeenCalled();
  });

  it('never calls isCancelled on the first attempt (only between retries)', async () => {
    const isCancelled = vi.fn().mockReturnValue(false);
    const factory = vi.fn().mockResolvedValue('first-try-success');

    await runWithRestart({ factory, isCancelled });

    // Success on first try → isCancelled should not have been checked at all
    expect(isCancelled).not.toHaveBeenCalled();
  });
});
