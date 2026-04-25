/**
 * Pyrfor Runtime — CronPersistenceStore
 *
 * JSON-backed registry for cron jobs: spec, last run, next run, last status.
 * Sits alongside CronService (see ./cron.ts) and does NOT modify it.
 *
 * The store can be loaded by an orchestrator at startup to seed CronService
 * and updated on each run for crash recovery.
 *
 * PERSISTENCE MODEL:
 *   flush() writes atomically (tmp + rename) using fs/promises.
 *   Writes are debounced — multiple mutations within autosaveDebounceMs
 *   coalesce into a single I/O operation.
 *   Concurrent flush() calls return the same in-flight promise.
 *
 * AUTO-DISABLE:
 *   After maxConsecutiveFailures (default 5) back-to-back failures, the job
 *   is disabled and a warn is emitted.  Set maxConsecutiveFailures=0 to
 *   disable this feature entirely.
 *
 * SKIPPED vs FAILURE:
 *   recordSkipped() increments totalRuns and sets lastStatus='skipped' but
 *   is neutral with respect to consecutiveFailures.
 */
export interface CronPersistedJob {
    id: string;
    name: string;
    /** Cron expression (croner-compatible). */
    cron: string;
    /** Handler name — orchestrator maps this string to a function. */
    handler: string;
    enabled: boolean;
    args?: Record<string, unknown>;
    ownerChatId?: string;
    ownerUserId?: string;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    lastDurationMs?: number;
    lastStatus?: 'success' | 'failure' | 'skipped';
    lastError?: string;
    consecutiveFailures: number;
    totalRuns: number;
    totalSuccesses: number;
    /** Computed externally; we just persist it. */
    nextRunAt?: string;
}
export interface CreateCronStoreOptions {
    /** JSON file path. In-memory only when omitted. */
    storePath?: string;
    /** Debounce window for auto-save. Default: 200 ms. */
    autosaveDebounceMs?: number;
    /** Monotonic clock. Default: Date.now. */
    clock?: () => number;
    logger?: (l: 'info' | 'warn' | 'error', m: string, meta?: any) => void;
    /** Auto-disable a job after this many consecutive failures. 0 = never auto-disable. Default: 5. */
    maxConsecutiveFailures?: number;
}
export interface CronPersistenceStore {
    upsert(input: {
        id?: string;
        name: string;
        cron: string;
        handler: string;
        enabled?: boolean;
        args?: Record<string, unknown>;
        ownerChatId?: string;
        ownerUserId?: string;
    }): CronPersistedJob;
    get(id: string): CronPersistedJob | undefined;
    list(opts?: {
        enabled?: boolean;
        ownerChatId?: string;
        ownerUserId?: string;
        handler?: string;
    }): CronPersistedJob[];
    remove(id: string): boolean;
    enable(id: string): boolean;
    disable(id: string): boolean;
    recordRun(id: string, result: {
        ok: boolean;
        durationMs: number;
        error?: string;
        nextRunAt?: string;
        /** Override wall-clock timestamp (ISO string). */
        ts?: string;
    }): CronPersistedJob | undefined;
    recordSkipped(id: string, reason?: string): CronPersistedJob | undefined;
    setNextRun(id: string, nextRunAt: string): boolean;
    stats(): {
        totalJobs: number;
        enabledJobs: number;
        totalRuns: number;
        totalSuccesses: number;
        /** totalRuns − totalSuccesses (includes skipped). */
        totalFailures: number;
        autoDisabledJobs: number;
    };
    /** Flush in-memory state to disk. Concurrent calls coalesce into one write. */
    flush(): Promise<void>;
    /** Clear all jobs and flush. */
    reset(): void;
}
export declare function createCronPersistenceStore(opts?: CreateCronStoreOptions): CronPersistenceStore;
//# sourceMappingURL=cron-persistence.d.ts.map