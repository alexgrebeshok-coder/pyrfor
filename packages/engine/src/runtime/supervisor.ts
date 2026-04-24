// @vitest-environment node
/**
 * Supervisor / Auto-restart — Pyrfor runtime process resilience.
 *
 * Provides two utilities:
 *   - installCrashHandlers: hooks uncaughtException / unhandledRejection
 *   - runWithRestart: factory retry loop with exponential back-off
 */

import { logger } from '../observability/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrashHandlerOptions {
  /** Called after logging; may be async. */
  onCrash?: (err: Error, source: string) => Promise<void> | void;
  /**
   * When true (default), calls process.exit(1) after onCrash completes.
   * Set to false in tests.
   */
  exitOnCrash?: boolean;
}

export interface RunWithRestartOptions<T> {
  factory: () => Promise<T>;
  /** Maximum number of restart attempts after the first failure. Default 5. */
  maxRestarts?: number;
  /** Initial back-off in ms (doubles each attempt, capped at 30 s). Default 1000. */
  backoffMs?: number;
  /** Checked before each retry; return true to stop gracefully. */
  isCancelled?: () => boolean;
}

// ---------------------------------------------------------------------------
// SupervisorGiveUpError
// ---------------------------------------------------------------------------

export class SupervisorGiveUpError extends Error {
  readonly restarts: number;
  readonly cause: unknown;

  constructor(restarts: number, lastError: unknown) {
    super(
      `[supervisor] gave up after ${restarts} restart${restarts === 1 ? '' : 's'}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
    this.name = 'SupervisorGiveUpError';
    this.restarts = restarts;
    this.cause = lastError;
  }
}

// ---------------------------------------------------------------------------
// installCrashHandlers
// ---------------------------------------------------------------------------

/**
 * Installs process-level handlers for uncaughtException and unhandledRejection.
 * Returns a `dispose()` function that removes both listeners (useful in tests).
 */
export function installCrashHandlers(opts: CrashHandlerOptions = {}): { dispose: () => void } {
  const { onCrash, exitOnCrash = true } = opts;

  const handle = (source: string) => async (errRaw: unknown) => {
    const err = errRaw instanceof Error ? errRaw : new Error(String(errRaw));
    logger.error(`[supervisor] ${source}: ${err.message}`, { stack: err.stack });

    try {
      if (onCrash) {
        await onCrash(err, source);
      }
    } catch (cbErr) {
      logger.error('[supervisor] onCrash callback threw', {
        error: cbErr instanceof Error ? cbErr.message : String(cbErr),
      });
    }

    if (exitOnCrash) {
      process.exit(1);
    }
  };

  const uncaughtHandler = handle('uncaughtException');
  const rejectionHandler = handle('unhandledRejection');

  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', rejectionHandler);

  return {
    dispose() {
      process.off('uncaughtException', uncaughtHandler);
      process.off('unhandledRejection', rejectionHandler);
    },
  };
}

// ---------------------------------------------------------------------------
// runWithRestart
// ---------------------------------------------------------------------------

const MAX_BACKOFF_MS = 30_000;

/**
 * Calls `factory` and returns its value. On failure, waits an exponentially
 * increasing delay and retries up to `maxRestarts` times.
 *
 * Throws `SupervisorGiveUpError` if all attempts fail.
 * Returns early (throws `SupervisorGiveUpError` with restarts=0…n) if
 * `isCancelled()` returns true between attempts.
 */
export async function runWithRestart<T>(opts: RunWithRestartOptions<T>): Promise<T> {
  const { factory, maxRestarts = 5, backoffMs = 1000, isCancelled } = opts;

  let attempt = 0;
  let lastError: unknown;
  let delay = backoffMs;

  while (attempt <= maxRestarts) {
    if (attempt > 0 && isCancelled?.()) {
      logger.info(`[supervisor] isCancelled=true — stopping after ${attempt - 1} restart(s)`);
      throw new SupervisorGiveUpError(attempt - 1, lastError);
    }

    try {
      const result = await factory();
      if (attempt > 0) {
        logger.info(`[supervisor] recovered after ${attempt} restart(s)`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < maxRestarts) {
        logger.warn(
          `[supervisor] factory failed (attempt ${attempt + 1}/${maxRestarts + 1}), retrying in ${delay}ms`,
          { error: err instanceof Error ? err.message : String(err) },
        );
        await sleep(delay);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      attempt++;
    }
  }

  logger.error(`[supervisor] giving up after ${maxRestarts} restart(s)`, {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new SupervisorGiveUpError(maxRestarts, lastError);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
