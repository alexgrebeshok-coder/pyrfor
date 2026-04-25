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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { randomBytes } from 'crypto';
import { readFileSync, mkdirSync } from 'fs';
import { writeFile, rename, unlink } from 'fs/promises';
import path from 'path';
// ── ULID-style id ──────────────────────────────────────────────────────────
function generateId() {
    return Date.now().toString(36) + randomBytes(10).toString('hex');
}
// ── Factory ────────────────────────────────────────────────────────────────
export function createCronPersistenceStore(opts) {
    var _a, _b, _c, _d;
    const storePath = opts === null || opts === void 0 ? void 0 : opts.storePath;
    const autosaveDebounceMs = (_a = opts === null || opts === void 0 ? void 0 : opts.autosaveDebounceMs) !== null && _a !== void 0 ? _a : 200;
    const clock = (_b = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _b !== void 0 ? _b : (() => Date.now());
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const log = (_c = opts === null || opts === void 0 ? void 0 : opts.logger) !== null && _c !== void 0 ? _c : (() => { });
    const maxConsecutiveFailures = (_d = opts === null || opts === void 0 ? void 0 : opts.maxConsecutiveFailures) !== null && _d !== void 0 ? _d : 5;
    const _jobs = new Map();
    let _debounceTimer = null;
    let _flushInFlight = null;
    // ── Init: load from disk ────────────────────────────────────────────────
    if (storePath) {
        try {
            const raw = readFileSync(storePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const job of parsed) {
                    _jobs.set(job.id, job);
                }
            }
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                log('warn', 'cron-persistence: failed to parse store file; starting empty', { err });
            }
        }
    }
    // ── Internal helpers ────────────────────────────────────────────────────
    function nowIso() {
        return new Date(clock()).toISOString();
    }
    function scheduleFlush() {
        if (!storePath)
            return;
        if (_debounceTimer !== null)
            clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            flush().catch((err) => log('error', 'cron-persistence: auto-flush failed', { err }));
        }, autosaveDebounceMs);
    }
    function doWrite() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!storePath)
                return;
            const dir = path.dirname(storePath);
            const tmp = path.join(dir, `.${path.basename(storePath)}.tmp.${randomBytes(4).toString('hex')}`);
            try {
                mkdirSync(dir, { recursive: true });
                const content = JSON.stringify(Array.from(_jobs.values()), null, 2);
                yield writeFile(tmp, content, 'utf8');
                yield rename(tmp, storePath);
            }
            catch (err) {
                try {
                    yield unlink(tmp);
                }
                catch (_a) {
                    // best-effort tmp cleanup
                }
                throw err;
            }
        });
    }
    function flush() {
        if (!storePath)
            return Promise.resolve();
        if (_flushInFlight !== null)
            return _flushInFlight;
        _flushInFlight = doWrite().finally(() => {
            _flushInFlight = null;
        });
        return _flushInFlight;
    }
    // ── Public API ──────────────────────────────────────────────────────────
    function upsert(input) {
        var _a, _b;
        const timestamp = nowIso();
        const resolvedId = (_a = input.id) !== null && _a !== void 0 ? _a : generateId();
        const existing = _jobs.get(resolvedId);
        let job;
        if (existing) {
            // Merge: update spec fields, preserve run counters and lastRun state.
            job = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, existing), { name: input.name, cron: input.cron, handler: input.handler, updatedAt: timestamp }), (input.enabled !== undefined && { enabled: input.enabled })), (input.args !== undefined && { args: input.args })), (input.ownerChatId !== undefined && { ownerChatId: input.ownerChatId })), (input.ownerUserId !== undefined && { ownerUserId: input.ownerUserId }));
        }
        else {
            job = Object.assign(Object.assign(Object.assign({ id: resolvedId, name: input.name, cron: input.cron, handler: input.handler, enabled: (_b = input.enabled) !== null && _b !== void 0 ? _b : true, createdAt: timestamp, updatedAt: timestamp, consecutiveFailures: 0, totalRuns: 0, totalSuccesses: 0 }, (input.args !== undefined && { args: input.args })), (input.ownerChatId !== undefined && { ownerChatId: input.ownerChatId })), (input.ownerUserId !== undefined && { ownerUserId: input.ownerUserId }));
        }
        _jobs.set(resolvedId, job);
        scheduleFlush();
        return job;
    }
    function get(id) {
        return _jobs.get(id);
    }
    function list(opts) {
        let items = Array.from(_jobs.values());
        if ((opts === null || opts === void 0 ? void 0 : opts.enabled) !== undefined)
            items = items.filter((j) => j.enabled === opts.enabled);
        if ((opts === null || opts === void 0 ? void 0 : opts.ownerChatId) !== undefined)
            items = items.filter((j) => j.ownerChatId === opts.ownerChatId);
        if ((opts === null || opts === void 0 ? void 0 : opts.ownerUserId) !== undefined)
            items = items.filter((j) => j.ownerUserId === opts.ownerUserId);
        if ((opts === null || opts === void 0 ? void 0 : opts.handler) !== undefined)
            items = items.filter((j) => j.handler === opts.handler);
        return items;
    }
    function remove(id) {
        const existed = _jobs.delete(id);
        if (existed)
            scheduleFlush();
        return existed;
    }
    function enable(id) {
        const job = _jobs.get(id);
        if (!job)
            return false;
        _jobs.set(id, Object.assign(Object.assign({}, job), { enabled: true, updatedAt: nowIso() }));
        scheduleFlush();
        return true;
    }
    function disable(id) {
        const job = _jobs.get(id);
        if (!job)
            return false;
        _jobs.set(id, Object.assign(Object.assign({}, job), { enabled: false, updatedAt: nowIso() }));
        scheduleFlush();
        return true;
    }
    function recordRun(id, result) {
        var _a, _b;
        const job = _jobs.get(id);
        if (!job)
            return undefined;
        const ts = (_a = result.ts) !== null && _a !== void 0 ? _a : nowIso();
        let updated = Object.assign(Object.assign({}, job), { totalRuns: job.totalRuns + 1, lastRunAt: ts, lastDurationMs: result.durationMs, updatedAt: ts });
        if (result.ok) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { lastError: _drop } = updated, rest = __rest(updated, ["lastError"]);
            updated = Object.assign(Object.assign({}, rest), { lastStatus: 'success', totalSuccesses: job.totalSuccesses + 1, consecutiveFailures: 0 });
        }
        else {
            const newConsecutive = job.consecutiveFailures + 1;
            updated = Object.assign(Object.assign({}, updated), { lastStatus: 'failure', lastError: (_b = result.error) !== null && _b !== void 0 ? _b : 'unknown', consecutiveFailures: newConsecutive });
            // Auto-disable when threshold is reached (feature disabled when maxConsecutiveFailures=0).
            if (maxConsecutiveFailures > 0 && updated.enabled && newConsecutive >= maxConsecutiveFailures) {
                updated = Object.assign(Object.assign({}, updated), { enabled: false });
                log('warn', `cron-persistence: auto-disabled job "${id}" after ${newConsecutive} consecutive failures`, {
                    id,
                    consecutiveFailures: newConsecutive,
                });
            }
        }
        if (result.nextRunAt !== undefined) {
            updated = Object.assign(Object.assign({}, updated), { nextRunAt: result.nextRunAt });
        }
        _jobs.set(id, updated);
        scheduleFlush();
        return updated;
    }
    function recordSkipped(id, _reason) {
        const job = _jobs.get(id);
        if (!job)
            return undefined;
        const ts = nowIso();
        const updated = Object.assign(Object.assign({}, job), { totalRuns: job.totalRuns + 1, lastStatus: 'skipped', lastRunAt: ts, updatedAt: ts });
        _jobs.set(id, updated);
        scheduleFlush();
        return updated;
    }
    function setNextRun(id, nextRunAt) {
        const job = _jobs.get(id);
        if (!job)
            return false;
        _jobs.set(id, Object.assign(Object.assign({}, job), { nextRunAt, updatedAt: nowIso() }));
        scheduleFlush();
        return true;
    }
    function stats() {
        const jobs = Array.from(_jobs.values());
        const totalJobs = jobs.length;
        const enabledJobs = jobs.filter((j) => j.enabled).length;
        const totalRuns = jobs.reduce((s, j) => s + j.totalRuns, 0);
        const totalSuccesses = jobs.reduce((s, j) => s + j.totalSuccesses, 0);
        // totalFailures includes skipped (totalRuns − totalSuccesses)
        const totalFailures = totalRuns - totalSuccesses;
        // autoDisabledJobs: disabled jobs at or above the consecutive-failure threshold
        const autoDisabledJobs = maxConsecutiveFailures > 0
            ? jobs.filter((j) => !j.enabled && j.consecutiveFailures >= maxConsecutiveFailures).length
            : 0;
        return { totalJobs, enabledJobs, totalRuns, totalSuccesses, totalFailures, autoDisabledJobs };
    }
    function reset() {
        _jobs.clear();
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        // Write the empty state immediately, bypassing debounce.
        if (storePath) {
            flush().catch((err) => log('error', 'cron-persistence: reset flush failed', { err }));
        }
    }
    return { upsert, get, list, remove, enable, disable, recordRun, recordSkipped, setNextRun, stats, flush, reset };
}
