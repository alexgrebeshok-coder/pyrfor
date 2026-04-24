/**
 * Generic retry / backoff / timeout / jitter wrapper.
 *
 * Inject `setTimer`, `clearTimer`, `rng`, and `clock` for deterministic tests.
 * No external dependencies.
 */

export interface RetryPolicy {
  /** Maximum total attempts (default 3). */
  maxAttempts?: number;
  /** Base delay in ms (default 200). */
  baseDelayMs?: number;
  /** Upper cap on computed delay before jitter (default 10_000). */
  maxDelayMs?: number;
  /** Delay growth strategy (default 'exponential'). */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /** Jitter strategy (default 'full'). */
  jitter?: 'none' | 'full' | 'equal';
  /**
   * Return true to retry after this error.
   * Called *before* the delay is applied.
   * Default: always retry.
   */
  retryOn?: (err: unknown, attempt: number) => boolean;
  /** Per-attempt timeout in ms; undefined = no timeout. */
  timeoutMs?: number;
  /** Called after each attempt (including the final one). */
  onAttempt?: (info: { attempt: number; err?: unknown; delayMs?: number }) => void;
  /** Abort the entire retry loop immediately when signalled. */
  signal?: AbortSignal;
  /** Timestamp source (default Date.now). */
  clock?: () => number;
  /** Timer factory (default globalThis.setTimeout). */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Timer canceller (default globalThis.clearTimeout). */
  clearTimer?: (h: unknown) => void;
  /** Random-number source in [0, 1) (default Math.random). */
  rng?: () => number;
}

export type RetryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number };

// ---------------------------------------------------------------------------
// Delay computation
// ---------------------------------------------------------------------------

function computeBaseDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoff: NonNullable<RetryPolicy['backoff']>,
): number {
  let d: number;
  if (backoff === 'exponential') {
    d = baseDelayMs * Math.pow(2, attempt - 1);
  } else if (backoff === 'linear') {
    d = baseDelayMs * attempt;
  } else {
    d = baseDelayMs;
  }
  return Math.min(d, maxDelayMs);
}

function applyJitter(
  delay: number,
  jitter: NonNullable<RetryPolicy['jitter']>,
  rng: () => number,
): number {
  if (jitter === 'full') return rng() * delay;
  if (jitter === 'equal') return delay / 2 + rng() * (delay / 2);
  return delay;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

export async function withRetry<T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T>,
  policy?: RetryPolicy,
): Promise<T> {
  const maxAttempts = policy?.maxAttempts ?? 3;
  const baseDelayMs = policy?.baseDelayMs ?? 200;
  const maxDelayMs = policy?.maxDelayMs ?? 10_000;
  const backoff = policy?.backoff ?? 'exponential';
  const jitter = policy?.jitter ?? 'full';
  const retryOn = policy?.retryOn ?? (() => true);
  const timeoutMs = policy?.timeoutMs;
  const onAttempt = policy?.onAttempt;
  const outerSignal = policy?.signal;
  const setTimer = policy?.setTimer ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
  const clearTimer = policy?.clearTimer ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const rng = policy?.rng ?? Math.random;

  // Throw immediately if outer signal is already aborted.
  if (outerSignal?.aborted) {
    throw outerSignal.reason ?? new DOMException('Aborted', 'AbortError');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check outer abort before each attempt.
    if (outerSignal?.aborted) {
      throw outerSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    let attemptError: unknown | undefined;

    try {
      let attemptSignal: AbortSignal | undefined;
      let timeoutAbortController: AbortController | undefined;

      if (timeoutMs !== undefined) {
        timeoutAbortController = new AbortController();
        attemptSignal = timeoutAbortController.signal;
      }

      // If there's an outer signal, combine it with the per-attempt signal.
      // We create a merged signal so the fn sees one AbortSignal.
      let signalForFn: AbortSignal | undefined;
      if (timeoutAbortController && outerSignal) {
        const merged = new AbortController();
        const abortMerged = () => merged.abort(outerSignal.reason);
        const abortMergedTimeout = () => merged.abort(timeoutAbortController!.signal.reason);
        if (outerSignal.aborted) {
          merged.abort(outerSignal.reason);
        } else {
          outerSignal.addEventListener('abort', abortMerged, { once: true });
          timeoutAbortController.signal.addEventListener('abort', abortMergedTimeout, { once: true });
        }
        signalForFn = merged.signal;
      } else if (timeoutAbortController) {
        signalForFn = timeoutAbortController.signal;
      } else {
        signalForFn = outerSignal;
      }

      if (timeoutMs !== undefined && timeoutAbortController) {
        // Race fn() against a timeout promise.
        let timeoutHandle: unknown;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimer(() => {
            timeoutAbortController!.abort(new DOMException('Attempt timed out', 'TimeoutError'));
            reject(new DOMException('Attempt timed out', 'TimeoutError'));
          }, timeoutMs);
        });

        try {
          const result = await Promise.race([fn(attempt, signalForFn), timeoutPromise]);
          clearTimer(timeoutHandle);
          onAttempt?.({ attempt });
          return result;
        } catch (err) {
          clearTimer(timeoutHandle);
          throw err;
        }
      } else {
        const result = await fn(attempt, signalForFn);
        onAttempt?.({ attempt });
        return result;
      }
    } catch (err) {
      attemptError = err;
      lastError = err;

      // If outer signal fired, propagate abort immediately.
      if (outerSignal?.aborted) {
        onAttempt?.({ attempt, err });
        throw outerSignal.reason ?? err;
      }

      const isLastAttempt = attempt >= maxAttempts;
      const shouldRetry = !isLastAttempt && retryOn(err, attempt);

      if (!shouldRetry) {
        onAttempt?.({ attempt, err });
        throw err;
      }

      // Compute delay for next attempt.
      const baseDelay = computeBaseDelay(attempt, baseDelayMs, maxDelayMs, backoff);
      const delayMs = applyJitter(baseDelay, jitter, rng);

      onAttempt?.({ attempt, err, delayMs });

      // Sleep with outer-signal cancellation support.
      await new Promise<void>((resolve, reject) => {
        let handle: unknown;
        const onAbort = () => {
          clearTimer(handle);
          reject(outerSignal!.reason ?? new DOMException('Aborted', 'AbortError'));
        };

        handle = setTimer(() => {
          outerSignal?.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);

        if (outerSignal) {
          if (outerSignal.aborted) {
            clearTimer(handle);
            reject(outerSignal.reason ?? new DOMException('Aborted', 'AbortError'));
          } else {
            outerSignal.addEventListener('abort', onAbort, { once: true });
          }
        }
      });
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// tryRetry — never throws
// ---------------------------------------------------------------------------

export async function tryRetry<T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T>,
  policy?: RetryPolicy,
): Promise<RetryResult<T>> {
  // We need attempt count even on failure; instrument onAttempt.
  let attempts = 0;
  const originalOnAttempt = policy?.onAttempt;

  const wrapped: RetryPolicy = {
    ...policy,
    onAttempt(info) {
      attempts = info.attempt;
      originalOnAttempt?.(info);
    },
  };

  try {
    const value = await withRetry(fn, wrapped);
    return { ok: true, value, attempts };
  } catch (error) {
    return { ok: false, error, attempts };
  }
}

// ---------------------------------------------------------------------------
// makeRetryWrapper — partial-application helper
// ---------------------------------------------------------------------------

export function makeRetryWrapper(
  defaults: RetryPolicy,
): <T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T>,
  policy?: RetryPolicy,
) => Promise<T> {
  return (fn, policy) => withRetry(fn, { ...defaults, ...policy });
}
