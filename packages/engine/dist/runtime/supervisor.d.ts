/**
 * Supervisor / Auto-restart — Pyrfor runtime process resilience.
 *
 * Provides two utilities:
 *   - installCrashHandlers: hooks uncaughtException / unhandledRejection
 *   - runWithRestart: factory retry loop with exponential back-off
 */
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
export declare class SupervisorGiveUpError extends Error {
    readonly restarts: number;
    readonly cause: unknown;
    constructor(restarts: number, lastError: unknown);
}
/**
 * Installs process-level handlers for uncaughtException and unhandledRejection.
 * Returns a `dispose()` function that removes both listeners (useful in tests).
 */
export declare function installCrashHandlers(opts?: CrashHandlerOptions): {
    dispose: () => void;
};
/**
 * Calls `factory` and returns its value. On failure, waits an exponentially
 * increasing delay and retries up to `maxRestarts` times.
 *
 * Throws `SupervisorGiveUpError` if all attempts fail.
 * Returns early (throws `SupervisorGiveUpError` with restarts=0…n) if
 * `isCancelled()` returns true between attempts.
 */
export declare function runWithRestart<T>(opts: RunWithRestartOptions<T>): Promise<T>;
//# sourceMappingURL=supervisor.d.ts.map