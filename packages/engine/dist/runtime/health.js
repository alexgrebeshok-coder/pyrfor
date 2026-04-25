/**
 * HealthMonitor — Pyrfor runtime health tracking.
 *
 * Standalone module: no external deps beyond node:* and ../observability/logger.
 *
 * Edge-case policy:
 *   - 0 checks registered → aggregate status = 'healthy'
 *   - addCheck with duplicate name → overwrites previous + warns
 *   - check throws → caught, {healthy:false, message: err.message}
 *   - check returns invalid object → {healthy:false, message:'invalid result'}
 *   - check exceeds timeoutMs → {healthy:false, message:'timeout after <N>ms'}
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
function deriveStatus(result) {
    if (result.status)
        return result.status;
    return result.healthy ? 'healthy' : 'unhealthy';
}
function isValidResult(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'healthy' in value &&
        typeof value.healthy === 'boolean');
}
function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
export class HealthMonitor {
    constructor(options) {
        var _a, _b;
        this.checks = new Map();
        this.lastSnapshot = null;
        this._restartCount = 0;
        this._running = false;
        this._interval = null;
        this._startedAt = null;
        this.intervalMs = (_a = options === null || options === void 0 ? void 0 : options.intervalMs) !== null && _a !== void 0 ? _a : 30000;
        this.loggerName = (_b = options === null || options === void 0 ? void 0 : options.loggerName) !== null && _b !== void 0 ? _b : 'health';
    }
    addCheck(name, fn, options) {
        var _a, _b, _c;
        if (this.checks.has(name)) {
            logger.warn(`[${this.loggerName}] Overwriting existing check`, { name });
        }
        this.checks.set(name, {
            fn,
            options: {
                critical: (_a = options === null || options === void 0 ? void 0 : options.critical) !== null && _a !== void 0 ? _a : false,
                timeoutMs: (_b = options === null || options === void 0 ? void 0 : options.timeoutMs) !== null && _b !== void 0 ? _b : 10000,
            },
            entry: {
                name,
                critical: (_c = options === null || options === void 0 ? void 0 : options.critical) !== null && _c !== void 0 ? _c : false,
                consecutiveFailures: 0,
            },
        });
    }
    removeCheck(name) {
        return this.checks.delete(name);
    }
    hasCheck(name) {
        return this.checks.has(name);
    }
    recordRestart() {
        this._restartCount++;
    }
    runChecks() {
        return __awaiter(this, void 0, void 0, function* () {
            const jobs = Array.from(this.checks.entries()).map((_a) => __awaiter(this, [_a], void 0, function* ([name, reg]) {
                var _b, _c;
                const t0 = Date.now();
                let result;
                try {
                    const raw = yield withTimeout(Promise.resolve(reg.fn()), reg.options.timeoutMs);
                    if (!isValidResult(raw)) {
                        result = { healthy: false, message: 'invalid result' };
                    }
                    else {
                        result = raw;
                    }
                }
                catch (err) {
                    result = {
                        healthy: false,
                        message: err instanceof Error ? err.message : String(err),
                    };
                }
                result = Object.assign(Object.assign({}, result), { latencyMs: Date.now() - t0 });
                const prevHealthy = (_c = (_b = reg.lastResult) === null || _b === void 0 ? void 0 : _b.healthy) !== null && _c !== void 0 ? _c : true;
                reg.lastResult = result;
                if (result.healthy) {
                    reg.entry.lastSuccessAt = new Date().toISOString();
                    reg.entry.consecutiveFailures = 0;
                }
                else {
                    reg.entry.lastFailureAt = new Date().toISOString();
                    reg.entry.consecutiveFailures++;
                }
                // Log only on transitions
                if (prevHealthy && !result.healthy) {
                    logger.info(`[${this.loggerName}] Check transitioned to unhealthy`, { name, message: result.message });
                }
                else if (!prevHealthy && result.healthy) {
                    logger.info(`[${this.loggerName}] Check recovered`, { name });
                }
                return { name, result, critical: reg.entry.critical };
            }));
            const settled = yield Promise.allSettled(jobs);
            const checksRecord = {};
            let hasUnhealthyCritical = false;
            let hasUnhealthyNonCritical = false;
            for (const outcome of settled) {
                if (outcome.status === 'fulfilled') {
                    const { name, result, critical } = outcome.value;
                    const reg = this.checks.get(name);
                    checksRecord[name] = Object.assign(Object.assign({}, result), { name,
                        critical, lastSuccessAt: reg.entry.lastSuccessAt, lastFailureAt: reg.entry.lastFailureAt, consecutiveFailures: reg.entry.consecutiveFailures });
                    if (!result.healthy) {
                        if (critical)
                            hasUnhealthyCritical = true;
                        else
                            hasUnhealthyNonCritical = true;
                    }
                }
            }
            const aggregateStatus = hasUnhealthyCritical
                ? 'unhealthy'
                : hasUnhealthyNonCritical
                    ? 'degraded'
                    : 'healthy';
            const snapshot = {
                status: aggregateStatus,
                timestamp: new Date().toISOString(),
                uptimeMs: this._startedAt != null ? Date.now() - this._startedAt : 0,
                restartCount: this._restartCount,
                checks: checksRecord,
            };
            this.lastSnapshot = snapshot;
            return snapshot;
        });
    }
    start() {
        if (this._running)
            return;
        this._running = true;
        this._startedAt = Date.now();
        logger.info(`[${this.loggerName}] Health monitor started`, {
            intervalMs: this.intervalMs,
            checks: this.checks.size,
        });
        this._interval = setInterval(() => {
            this.runChecks().catch((err) => logger.error(`[${this.loggerName}] runChecks failed`, { error: String(err) }));
        }, this.intervalMs);
        // Don't block the event loop
        this._interval.unref();
    }
    stop() {
        if (!this._running)
            return;
        if (this._interval != null) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this._running = false;
        logger.info(`[${this.loggerName}] Health monitor stopped`);
    }
    getLastSnapshot() {
        return this.lastSnapshot;
    }
    isRunning() {
        return this._running;
    }
}
