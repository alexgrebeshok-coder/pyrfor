/**
 * Pyrfor Runtime — CronService
 *
 * Scheduled job execution using croner.
 * Standalone module: depends only on croner, node builtins, and observability/logger.
 */
export declare class CronServiceError extends Error {
    details?: unknown | undefined;
    constructor(message: string, details?: unknown | undefined);
}
export interface CronJobSpec {
    /** Unique key. */
    name: string;
    /** Croner-compatible schedule expression. */
    schedule: string;
    /** Handler key (must be registered before start). */
    handler: string;
    /** Default true. */
    enabled?: boolean;
    /** Optional IANA timezone (e.g. 'Europe/Moscow'). */
    timezone?: string;
    /** Optional opaque payload passed to handler. */
    payload?: unknown;
}
export type CronHandlerFn = (ctx: CronExecutionContext) => Promise<void> | void;
export interface CronExecutionContext {
    job: CronJobSpec;
    /** Wall-clock fire time. */
    firedAt: Date;
    /** Trigger source. */
    source: 'scheduled' | 'manual';
}
export interface CronJobStatus {
    name: string;
    schedule: string;
    handler: string;
    enabled: boolean;
    timezone?: string;
    /** Next scheduled run time (null if disabled or stopped). */
    nextRunAt: string | null;
    /** Last successful run (ISO). */
    lastRunAt: string | null;
    /** Last error message if last run failed. */
    lastError: string | null;
    /** Cumulative successful runs. */
    successCount: number;
    /** Cumulative failed runs. */
    failureCount: number;
    /** Whether the job is currently executing. */
    isRunning: boolean;
}
export interface CronServiceOptions {
    /** Default timezone applied to jobs without explicit one. */
    defaultTimezone?: string;
    loggerName?: string;
    /**
     * If true, manual triggers are queued when an execution is in progress.
     * Default false → triggerJob throws CronServiceError if already running.
     */
    serializeManualTriggers?: boolean;
}
export declare class CronService {
    private readonly handlers;
    private readonly jobs;
    private running;
    private readonly options;
    constructor(options?: CronServiceOptions);
    registerHandler(key: string, fn: CronHandlerFn): void;
    unregisterHandler(key: string): boolean;
    hasHandler(key: string): boolean;
    /**
     * Start scheduling jobs. Throws if any job references an unknown handler.
     * Idempotent: re-calling with same jobs does not duplicate them.
     */
    start(jobs: CronJobSpec[]): void;
    stop(): void;
    isRunning(): boolean;
    /** Add a job at runtime. Throws if name conflicts or handler missing. */
    addJob(job: CronJobSpec): void;
    /** Remove a job by name. Returns true if existed. */
    removeJob(name: string): boolean;
    /**
     * Manually trigger a job.
     * - If serializeManualTriggers=false (default) and the job is executing → throws.
     * - If serializeManualTriggers=true → queues behind current execution.
     */
    triggerJob(name: string): Promise<void>;
    getStatus(): CronJobStatus[];
    private _scheduleJob;
    private _execute;
}
//# sourceMappingURL=cron.d.ts.map