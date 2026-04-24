// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
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
