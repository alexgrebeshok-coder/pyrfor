// @vitest-environment node
/**
 * Supervisor / Auto-restart — Pyrfor runtime process resilience.
 *
 * Provides two utilities:
 *   - installCrashHandlers: hooks uncaughtException / unhandledRejection
 *   - runWithRestart: factory retry loop with exponential back-off
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
// ---------------------------------------------------------------------------
// SupervisorGiveUpError
// ---------------------------------------------------------------------------
export class SupervisorGiveUpError extends Error {
    constructor(restarts, lastError) {
        super(`[supervisor] gave up after ${restarts} restart${restarts === 1 ? '' : 's'}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
export function installCrashHandlers(opts = {}) {
    const { onCrash, exitOnCrash = true } = opts;
    const handle = (source) => (errRaw) => __awaiter(this, void 0, void 0, function* () {
        const err = errRaw instanceof Error ? errRaw : new Error(String(errRaw));
        logger.error(`[supervisor] ${source}: ${err.message}`, { stack: err.stack });
        try {
            if (onCrash) {
                yield onCrash(err, source);
            }
        }
        catch (cbErr) {
            logger.error('[supervisor] onCrash callback threw', {
                error: cbErr instanceof Error ? cbErr.message : String(cbErr),
            });
        }
        if (exitOnCrash) {
            process.exit(1);
        }
    });
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
const MAX_BACKOFF_MS = 30000;
/**
 * Calls `factory` and returns its value. On failure, waits an exponentially
 * increasing delay and retries up to `maxRestarts` times.
 *
 * Throws `SupervisorGiveUpError` if all attempts fail.
 * Returns early (throws `SupervisorGiveUpError` with restarts=0…n) if
 * `isCancelled()` returns true between attempts.
 */
export function runWithRestart(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { factory, maxRestarts = 5, backoffMs = 1000, isCancelled } = opts;
        let attempt = 0;
        let lastError;
        let delay = backoffMs;
        while (attempt <= maxRestarts) {
            if (attempt > 0 && (isCancelled === null || isCancelled === void 0 ? void 0 : isCancelled())) {
                logger.info(`[supervisor] isCancelled=true — stopping after ${attempt - 1} restart(s)`);
                throw new SupervisorGiveUpError(attempt - 1, lastError);
            }
            try {
                const result = yield factory();
                if (attempt > 0) {
                    logger.info(`[supervisor] recovered after ${attempt} restart(s)`);
                }
                return result;
            }
            catch (err) {
                lastError = err;
                if (attempt < maxRestarts) {
                    logger.warn(`[supervisor] factory failed (attempt ${attempt + 1}/${maxRestarts + 1}), retrying in ${delay}ms`, { error: err instanceof Error ? err.message : String(err) });
                    yield sleep(delay);
                    delay = Math.min(delay * 2, MAX_BACKOFF_MS);
                }
                attempt++;
            }
        }
        logger.error(`[supervisor] giving up after ${maxRestarts} restart(s)`, {
            error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        throw new SupervisorGiveUpError(maxRestarts, lastError);
    });
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
