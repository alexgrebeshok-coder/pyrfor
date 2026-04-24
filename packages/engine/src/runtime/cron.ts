/**
 * Pyrfor Runtime — CronService
 *
 * Scheduled job execution using croner.
 * Standalone module: depends only on croner, node builtins, and observability/logger.
 */

import { Cron } from 'croner';
import { logger } from '../observability/logger';

// ─── Error ────────────────────────────────────────────────────────────────────

export class CronServiceError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'CronServiceError';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Internal state ───────────────────────────────────────────────────────────

interface JobState {
  spec: CronJobSpec;
  cron: Cron;
  lastRunAt: Date | null;
  lastError: string | null;
  successCount: number;
  failureCount: number;
  /** Whether a handler execution is currently in progress. */
  executing: boolean;
  /** Pending manual trigger promise chain (serializeManualTriggers mode). */
  pendingTrigger: Promise<void> | null;
}

// ─── CronService ──────────────────────────────────────────────────────────────

export class CronService {
  private readonly handlers = new Map<string, CronHandlerFn>();
  private readonly jobs = new Map<string, JobState>();
  private running = false;
  private readonly options: Required<CronServiceOptions>;

  constructor(options: CronServiceOptions = {}) {
    this.options = {
      defaultTimezone: options.defaultTimezone ?? '',
      loggerName: options.loggerName ?? 'CronService',
      serializeManualTriggers: options.serializeManualTriggers ?? false,
    };
  }

  // ─── Handler registry ────────────────────────────────────────────────────

  registerHandler(key: string, fn: CronHandlerFn): void {
    this.handlers.set(key, fn);
    logger.debug(`[${this.options.loggerName}] Handler registered`, { key });
  }

  unregisterHandler(key: string): boolean {
    return this.handlers.delete(key);
  }

  hasHandler(key: string): boolean {
    return this.handlers.has(key);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Start scheduling jobs. Throws if any job references an unknown handler.
   * Idempotent: re-calling with same jobs does not duplicate them.
   */
  start(jobs: CronJobSpec[]): void {
    const missing = jobs
      .filter(j => (j.enabled ?? true) && !this.handlers.has(j.handler))
      .map(j => j.handler);

    if (missing.length > 0) {
      throw new CronServiceError(
        `Missing handlers: ${[...new Set(missing)].join(', ')}`,
        { missing },
      );
    }

    this.running = true;

    for (const spec of jobs) {
      if (this.jobs.has(spec.name)) {
        // Already scheduled — skip to stay idempotent.
        continue;
      }
      this._scheduleJob(spec);
    }

    logger.info(`[${this.options.loggerName}] Started`, { jobCount: this.jobs.size });
  }

  stop(): void {
    for (const state of this.jobs.values()) {
      state.cron.stop();
    }
    this.jobs.clear();
    this.running = false;
    logger.info(`[${this.options.loggerName}] Stopped`);
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Runtime job management ──────────────────────────────────────────────

  /** Add a job at runtime. Throws if name conflicts or handler missing. */
  addJob(job: CronJobSpec): void {
    if (this.jobs.has(job.name)) {
      throw new CronServiceError(`Job "${job.name}" already exists`);
    }

    const enabled = job.enabled ?? true;
    if (enabled && !this.handlers.has(job.handler)) {
      throw new CronServiceError(`Handler "${job.handler}" not registered`);
    }

    this._scheduleJob(job);
    logger.debug(`[${this.options.loggerName}] Job added at runtime`, { name: job.name });
  }

  /** Remove a job by name. Returns true if existed. */
  removeJob(name: string): boolean {
    const state = this.jobs.get(name);
    if (!state) return false;
    state.cron.stop();
    this.jobs.delete(name);
    logger.debug(`[${this.options.loggerName}] Job removed`, { name });
    return true;
  }

  // ─── Triggering ──────────────────────────────────────────────────────────

  /**
   * Manually trigger a job.
   * - If serializeManualTriggers=false (default) and the job is executing → throws.
   * - If serializeManualTriggers=true → queues behind current execution.
   */
  async triggerJob(name: string): Promise<void> {
    const state = this.jobs.get(name);
    if (!state) {
      throw new CronServiceError(`Job "${name}" not found`);
    }

    if (state.executing) {
      if (!this.options.serializeManualTriggers) {
        throw new CronServiceError(
          `Job "${name}" is already executing. Use serializeManualTriggers to queue.`,
        );
      }
      // Serialize: chain behind the pending trigger promise.
      const next = (state.pendingTrigger ?? Promise.resolve()).then(() =>
        this._execute(state, 'manual'),
      );
      state.pendingTrigger = next;
      return next;
    }

    return this._execute(state, 'manual');
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  getStatus(): CronJobStatus[] {
    return Array.from(this.jobs.values()).map(state => {
      const { spec } = state;
      const enabled = spec.enabled ?? true;
      const nextRun = state.cron.nextRun();
      return {
        name: spec.name,
        schedule: spec.schedule,
        handler: spec.handler,
        enabled,
        timezone: spec.timezone ?? (this.options.defaultTimezone || undefined),
        nextRunAt: nextRun ? nextRun.toISOString() : null,
        lastRunAt: state.lastRunAt ? state.lastRunAt.toISOString() : null,
        lastError: state.lastError,
        successCount: state.successCount,
        failureCount: state.failureCount,
        isRunning: state.executing,
      };
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private _scheduleJob(spec: CronJobSpec): void {
    const enabled = spec.enabled ?? true;
    const tz = spec.timezone ?? this.options.defaultTimezone;

    // Validate the expression by constructing the Cron instance.
    // croner throws on invalid pattern.
    let cron: Cron;
    try {
      cron = new Cron(
        spec.schedule,
        {
          name: spec.name,
          paused: !enabled,
          // protect: true prevents parallel scheduled runs of the same job.
          protect: true,
          ...(tz ? { timezone: tz } : {}),
        },
        async () => {
          const state = this.jobs.get(spec.name);
          if (!state) return;
          await this._execute(state, 'scheduled');
        },
      );
    } catch (err) {
      throw new CronServiceError(
        `Invalid cron expression "${spec.schedule}" for job "${spec.name}"`,
        err,
      );
    }

    const state: JobState = {
      spec,
      cron,
      lastRunAt: null,
      lastError: null,
      successCount: 0,
      failureCount: 0,
      executing: false,
      pendingTrigger: null,
    };

    this.jobs.set(spec.name, state);
  }

  private async _execute(state: JobState, source: 'scheduled' | 'manual'): Promise<void> {
    const { spec } = state;
    const fn = this.handlers.get(spec.handler);
    if (!fn) {
      logger.warn(`[${this.options.loggerName}] Handler "${spec.handler}" not found at execution time`, {
        job: spec.name,
      });
      return;
    }

    state.executing = true;
    const firedAt = new Date();

    logger.debug(`[${this.options.loggerName}] Executing job`, {
      name: spec.name,
      source,
    });

    try {
      await fn({ job: spec, firedAt, source });
      state.lastRunAt = new Date();
      state.lastError = null;
      state.successCount++;
      logger.debug(`[${this.options.loggerName}] Job succeeded`, {
        name: spec.name,
        successCount: state.successCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.lastRunAt = new Date();
      state.lastError = msg;
      state.failureCount++;
      logger.error(`[${this.options.loggerName}] Job failed`, {
        name: spec.name,
        error: msg,
        failureCount: state.failureCount,
      });
      throw err;
    } finally {
      state.executing = false;
      state.pendingTrigger = null;
    }
  }
}
