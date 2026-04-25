/**
 * Pyrfor Runtime — CronService
 *
 * Scheduled job execution using croner.
 * Standalone module: depends only on croner, node builtins, and observability/logger.
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
import { Cron } from 'croner';
import { logger } from '../observability/logger.js';
// ─── Error ────────────────────────────────────────────────────────────────────
export class CronServiceError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'CronServiceError';
    }
}
// ─── CronService ──────────────────────────────────────────────────────────────
export class CronService {
    constructor(options = {}) {
        var _a, _b, _c;
        this.handlers = new Map();
        this.jobs = new Map();
        this.running = false;
        this.options = {
            defaultTimezone: (_a = options.defaultTimezone) !== null && _a !== void 0 ? _a : '',
            loggerName: (_b = options.loggerName) !== null && _b !== void 0 ? _b : 'CronService',
            serializeManualTriggers: (_c = options.serializeManualTriggers) !== null && _c !== void 0 ? _c : false,
        };
    }
    // ─── Handler registry ────────────────────────────────────────────────────
    registerHandler(key, fn) {
        this.handlers.set(key, fn);
        logger.debug(`[${this.options.loggerName}] Handler registered`, { key });
    }
    unregisterHandler(key) {
        return this.handlers.delete(key);
    }
    hasHandler(key) {
        return this.handlers.has(key);
    }
    // ─── Lifecycle ───────────────────────────────────────────────────────────
    /**
     * Start scheduling jobs. Throws if any job references an unknown handler.
     * Idempotent: re-calling with same jobs does not duplicate them.
     */
    start(jobs) {
        const missing = jobs
            .filter(j => { var _a; return ((_a = j.enabled) !== null && _a !== void 0 ? _a : true) && !this.handlers.has(j.handler); })
            .map(j => j.handler);
        if (missing.length > 0) {
            throw new CronServiceError(`Missing handlers: ${[...new Set(missing)].join(', ')}`, { missing });
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
    stop() {
        for (const state of this.jobs.values()) {
            state.cron.stop();
        }
        this.jobs.clear();
        this.running = false;
        logger.info(`[${this.options.loggerName}] Stopped`);
    }
    isRunning() {
        return this.running;
    }
    // ─── Runtime job management ──────────────────────────────────────────────
    /** Add a job at runtime. Throws if name conflicts or handler missing. */
    addJob(job) {
        var _a;
        if (this.jobs.has(job.name)) {
            throw new CronServiceError(`Job "${job.name}" already exists`);
        }
        const enabled = (_a = job.enabled) !== null && _a !== void 0 ? _a : true;
        if (enabled && !this.handlers.has(job.handler)) {
            throw new CronServiceError(`Handler "${job.handler}" not registered`);
        }
        this._scheduleJob(job);
        logger.debug(`[${this.options.loggerName}] Job added at runtime`, { name: job.name });
    }
    /** Remove a job by name. Returns true if existed. */
    removeJob(name) {
        const state = this.jobs.get(name);
        if (!state)
            return false;
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
    triggerJob(name) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const state = this.jobs.get(name);
            if (!state) {
                throw new CronServiceError(`Job "${name}" not found`);
            }
            if (state.executing) {
                if (!this.options.serializeManualTriggers) {
                    throw new CronServiceError(`Job "${name}" is already executing. Use serializeManualTriggers to queue.`);
                }
                // Serialize: chain behind the pending trigger promise.
                const next = ((_a = state.pendingTrigger) !== null && _a !== void 0 ? _a : Promise.resolve()).then(() => this._execute(state, 'manual'));
                state.pendingTrigger = next;
                return next;
            }
            return this._execute(state, 'manual');
        });
    }
    // ─── Status ──────────────────────────────────────────────────────────────
    getStatus() {
        return Array.from(this.jobs.values()).map(state => {
            var _a, _b;
            const { spec } = state;
            const enabled = (_a = spec.enabled) !== null && _a !== void 0 ? _a : true;
            const nextRun = state.cron.nextRun();
            return {
                name: spec.name,
                schedule: spec.schedule,
                handler: spec.handler,
                enabled,
                timezone: (_b = spec.timezone) !== null && _b !== void 0 ? _b : (this.options.defaultTimezone || undefined),
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
    _scheduleJob(spec) {
        var _a, _b;
        const enabled = (_a = spec.enabled) !== null && _a !== void 0 ? _a : true;
        const tz = (_b = spec.timezone) !== null && _b !== void 0 ? _b : this.options.defaultTimezone;
        // Validate the expression by constructing the Cron instance.
        // croner throws on invalid pattern.
        let cron;
        try {
            cron = new Cron(spec.schedule, Object.assign({ name: spec.name, paused: !enabled, 
                // protect: true prevents parallel scheduled runs of the same job.
                protect: true }, (tz ? { timezone: tz } : {})), () => __awaiter(this, void 0, void 0, function* () {
                const state = this.jobs.get(spec.name);
                if (!state)
                    return;
                yield this._execute(state, 'scheduled');
            }));
        }
        catch (err) {
            throw new CronServiceError(`Invalid cron expression "${spec.schedule}" for job "${spec.name}"`, err);
        }
        const state = {
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
    _execute(state, source) {
        return __awaiter(this, void 0, void 0, function* () {
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
                yield fn({ job: spec, firedAt, source });
                state.lastRunAt = new Date();
                state.lastError = null;
                state.successCount++;
                logger.debug(`[${this.options.loggerName}] Job succeeded`, {
                    name: spec.name,
                    successCount: state.successCount,
                });
            }
            catch (err) {
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
            }
            finally {
                state.executing = false;
                state.pendingTrigger = null;
            }
        });
    }
}
