/**
 * Pyrfor Runtime — Persistent Priority Task Queue
 *
 * Features: concurrency cap, retries with exponential backoff, deduplication,
 * backpressure, optional JSON persistence (atomic tmp+rename), per-task
 * AbortController, injectable clock + timer for deterministic testing.
 *
 * No external dependencies. Node builtins only.
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
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// ─── Helpers ──────────────────────────────────────────────────────────────────
const FINISHED = new Set(['done', 'failed', 'cancelled']);
function genId() {
    return randomBytes(8).toString('hex');
}
// ─── Factory ──────────────────────────────────────────────────────────────────
export function createTaskQueue(opts = {}) {
    var _a, _b, _c, _d, _e, _f;
    const concurrency = (_a = opts.concurrency) !== null && _a !== void 0 ? _a : 2;
    const clock = (_b = opts.clock) !== null && _b !== void 0 ? _b : (() => Date.now());
    const flushDebounceMs = (_c = opts.flushDebounceMs) !== null && _c !== void 0 ? _c : 500;
    const setTimer = (_d = opts.setTimer) !== null && _d !== void 0 ? _d : ((cb, ms) => setTimeout(cb, ms));
    const clearTimer = (_e = opts.clearTimer) !== null && _e !== void 0 ? _e : ((h) => clearTimeout(h));
    const log = (_f = opts.logger) !== null && _f !== void 0 ? _f : (() => { });
    // ── State ──────────────────────────────────────────────────────────────────
    const tasks = new Map();
    const handlers = new Map();
    const controllers = new Map();
    const listeners = new Map();
    let running = 0;
    let started = false;
    let stopping = false;
    let flushTimer = null;
    let futureTickTimer = null;
    const drainResolvers = [];
    const stopResolvers = [];
    // ── Persistence ────────────────────────────────────────────────────────────
    function loadFromDisk() {
        if (!opts.storePath || !existsSync(opts.storePath))
            return;
        try {
            const raw = readFileSync(opts.storePath, 'utf8');
            const data = JSON.parse(raw);
            if (!Array.isArray(data))
                throw new Error('expected array');
            for (const t of data)
                tasks.set(t.id, t);
        }
        catch (e) {
            log('task-queue: corrupt store, starting empty', { error: e });
        }
    }
    function scheduleFlush() {
        if (!opts.storePath)
            return;
        if (flushTimer !== null)
            clearTimer(flushTimer);
        flushTimer = setTimer(() => {
            flushTimer = null;
            flushToDisk();
        }, flushDebounceMs);
    }
    function flushToDisk() {
        if (!opts.storePath)
            return;
        try {
            mkdirSync(dirname(opts.storePath), { recursive: true });
            const tmp = opts.storePath + '.tmp';
            writeFileSync(tmp, JSON.stringify([...tasks.values()], null, 2), 'utf8');
            renameSync(tmp, opts.storePath);
        }
        catch (e) {
            log('task-queue: flush failed', { error: e });
        }
    }
    function immediateFlush() {
        if (!opts.storePath)
            return;
        if (flushTimer !== null) {
            clearTimer(flushTimer);
            flushTimer = null;
        }
        flushToDisk();
    }
    // ── Events ─────────────────────────────────────────────────────────────────
    function emit(event, task) {
        const cbs = listeners.get(event);
        if (cbs)
            for (const cb of [...cbs])
                cb(task);
    }
    // ── Drain / Stop resolution ────────────────────────────────────────────────
    function checkDrain() {
        if (drainResolvers.length === 0)
            return;
        if (running > 0)
            return;
        const hasQueued = [...tasks.values()].some((t) => t.state === 'queued');
        if (!hasQueued) {
            const resolvers = drainResolvers.splice(0);
            for (const r of resolvers)
                r();
        }
    }
    function checkStop() {
        if (stopResolvers.length === 0)
            return;
        if (running === 0) {
            started = false;
            immediateFlush();
            const resolvers = stopResolvers.splice(0);
            for (const r of resolvers)
                r();
        }
    }
    function checkIdle() {
        if (!started || stopping)
            return;
        if (running > 0)
            return;
        const hasActive = [...tasks.values()].some((t) => t.state === 'queued' || t.state === 'running');
        if (!hasActive)
            emit('idle');
    }
    // ── Scheduling ─────────────────────────────────────────────────────────────
    function pickNext() {
        var _a;
        const now = clock();
        let best;
        for (const t of tasks.values()) {
            if (t.state !== 'queued')
                continue;
            if (((_a = t.runAt) !== null && _a !== void 0 ? _a : 0) > now)
                continue;
            if (!best) {
                best = t;
                continue;
            }
            if (t.priority > best.priority) {
                best = t;
                continue;
            }
            if (t.priority === best.priority && t.createdAt < best.createdAt)
                best = t;
        }
        return best;
    }
    function scheduleFutureTick() {
        const now = clock();
        let minRunAt = Infinity;
        for (const t of tasks.values()) {
            if (t.state === 'queued' && t.runAt !== undefined && t.runAt > now) {
                minRunAt = Math.min(minRunAt, t.runAt);
            }
        }
        if (minRunAt < Infinity) {
            if (futureTickTimer !== null)
                clearTimer(futureTickTimer);
            futureTickTimer = setTimer(() => {
                futureTickTimer = null;
                tick();
            }, minRunAt - now);
        }
    }
    // ── Execution ──────────────────────────────────────────────────────────────
    function tick() {
        if (!started || stopping)
            return;
        while (running < concurrency) {
            const task = pickNext();
            if (!task)
                break;
            execute(task);
        }
        scheduleFutureTick();
        checkIdle();
    }
    function execute(task) {
        const handler = handlers.get(task.kind);
        if (!handler) {
            task.state = 'failed';
            task.finishedAt = clock();
            task.lastError = `No handler registered for kind: ${task.kind}`;
            emit('failed', task);
            scheduleFlush();
            checkDrain();
            checkStop();
            return;
        }
        const ac = new AbortController();
        controllers.set(task.id, ac);
        task.state = 'running';
        task.startedAt = clock();
        task.attempts += 1;
        running++;
        emit('started', task);
        scheduleFlush();
        handler(Object.assign({}, task), ac.signal)
            .then(() => {
            controllers.delete(task.id);
            running--;
            if (task.state !== 'cancelled') {
                task.state = 'done';
                task.finishedAt = clock();
                emit('completed', task);
            }
            scheduleFlush();
            checkDrain();
            checkStop();
            tick();
        })
            .catch((err) => {
            controllers.delete(task.id);
            running--;
            if (task.state === 'cancelled') {
                scheduleFlush();
                checkDrain();
                checkStop();
                tick();
                return;
            }
            const errMsg = err instanceof Error ? err.message : String(err);
            task.lastError = errMsg;
            if (task.attempts < task.maxAttempts) {
                const delay = Math.min(Math.pow(2, task.attempts) * 1000, 60000);
                task.state = 'queued';
                task.runAt = clock() + delay;
                emit('retry', task);
                scheduleFlush();
                // Schedule a tick once the delay expires
                setTimer(() => tick(), delay);
            }
            else {
                task.state = 'failed';
                task.finishedAt = clock();
                emit('failed', task);
                scheduleFlush();
                checkDrain();
                checkStop();
            }
            tick();
        });
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    function registerHandler(kind, handler) {
        handlers.set(kind, handler);
    }
    function enqueue(input) {
        var _a, _b, _c;
        if (input.dedupKey) {
            for (const t of tasks.values()) {
                if (t.dedupKey === input.dedupKey && !FINISHED.has(t.state))
                    return t;
            }
        }
        const task = {
            id: genId(),
            kind: input.kind,
            payload: (_a = input.payload) !== null && _a !== void 0 ? _a : null,
            priority: (_b = input.priority) !== null && _b !== void 0 ? _b : 0,
            attempts: 0,
            maxAttempts: (_c = input.maxAttempts) !== null && _c !== void 0 ? _c : 3,
            state: 'queued',
            createdAt: clock(),
            runAt: input.runAt,
            dedupKey: input.dedupKey,
        };
        tasks.set(task.id, task);
        emit('enqueued', task);
        scheduleFlush();
        if (started && !stopping)
            tick();
        return task;
    }
    function get(id) {
        return tasks.get(id);
    }
    function list(filter) {
        let result = [...tasks.values()];
        if (filter === null || filter === void 0 ? void 0 : filter.state)
            result = result.filter((t) => t.state === filter.state);
        if (filter === null || filter === void 0 ? void 0 : filter.kind)
            result = result.filter((t) => t.kind === filter.kind);
        return result;
    }
    function cancel(id) {
        const task = tasks.get(id);
        if (!task)
            return false;
        if (task.state === 'queued') {
            task.state = 'cancelled';
            task.finishedAt = clock();
            emit('cancelled', task);
            scheduleFlush();
            checkDrain();
            tick();
            return true;
        }
        if (task.state === 'running') {
            const ac = controllers.get(id);
            if (ac)
                ac.abort();
            task.state = 'cancelled';
            task.finishedAt = clock();
            emit('cancelled', task);
            scheduleFlush();
            // drain/stop resolved when the handler promise settles (decrement running)
            return true;
        }
        return false;
    }
    function start() {
        loadFromDisk();
        // Reset any in-flight tasks left over from a previous run
        for (const t of tasks.values()) {
            if (t.state === 'running') {
                t.state = 'queued';
                t.startedAt = undefined;
            }
        }
        started = true;
        stopping = false;
        tick();
    }
    function stop() {
        return __awaiter(this, void 0, void 0, function* () {
            stopping = true;
            for (const ac of controllers.values())
                ac.abort();
            if (running === 0) {
                started = false;
                immediateFlush();
                return;
            }
            return new Promise((resolve) => {
                stopResolvers.push(resolve);
            });
        });
    }
    function drain() {
        return __awaiter(this, void 0, void 0, function* () {
            if (running === 0) {
                const hasQueued = [...tasks.values()].some((t) => t.state === 'queued');
                if (!hasQueued)
                    return;
            }
            return new Promise((resolve) => {
                drainResolvers.push(resolve);
            });
        });
    }
    function on(event, cb) {
        if (!listeners.has(event))
            listeners.set(event, new Set());
        listeners.get(event).add(cb);
        return () => { var _a; return (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(cb); };
    }
    return { registerHandler, enqueue, get, list, cancel, start, stop, drain, on };
}
