/**
 * subagent-orchestrator.ts — Pyrfor Phase E: hierarchical SubagentOrchestrator.
 *
 * Spawns child tasks (subagents) with isolated tool subsets, per-agent budgets
 * (tokens, iterations, wall-clock ms), and AbortController propagation.
 * Supports parallel and serial dispatch with a concurrency semaphore.
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
// ── Helpers ───────────────────────────────────────────────────────────────────
function generateId() {
    return Date.now().toString(36) + randomBytes(10).toString('hex');
}
/** Simple counting semaphore — resolves `acquire` as soon as a slot opens. */
class Semaphore {
    constructor(limit) {
        this._waiters = [];
        this._count = limit;
    }
    acquire() {
        if (this._count > 0) {
            this._count--;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this._waiters.push(resolve);
        });
    }
    release() {
        const next = this._waiters.shift();
        if (next) {
            next();
        }
        else {
            this._count++;
        }
    }
}
// ── Factory ───────────────────────────────────────────────────────────────────
export function createSubagentOrchestrator(opts) {
    var _a, _b, _c, _d, _e, _f;
    const clock = (_a = opts.clock) !== null && _a !== void 0 ? _a : (() => Date.now());
    const log = (_b = opts.logger) !== null && _b !== void 0 ? _b : (() => { });
    const concurrencyLimit = Math.max(1, (_c = opts.concurrencyLimit) !== null && _c !== void 0 ? _c : 4);
    const defaultMaxIterations = (_d = opts.defaultMaxIterations) !== null && _d !== void 0 ? _d : 10;
    const defaultMaxTokens = (_e = opts.defaultMaxTokens) !== null && _e !== void 0 ? _e : 8000;
    const defaultMaxDurationMs = (_f = opts.defaultMaxDurationMs) !== null && _f !== void 0 ? _f : 60000;
    const semaphore = new Semaphore(concurrencyLimit);
    // active agents: id → { controller, role, startedAt, promise }
    const _active = new Map();
    // all in-flight promises (for shutdown)
    const _allPromises = new Set();
    let _isShutdown = false;
    // ── spawn ─────────────────────────────────────────────────────────────────
    function spawn(spec) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const id = (_a = spec.id) !== null && _a !== void 0 ? _a : generateId();
            const maxDurationMs = (_b = spec.maxDurationMs) !== null && _b !== void 0 ? _b : defaultMaxDurationMs;
            const maxTokens = (_c = spec.maxTokens) !== null && _c !== void 0 ? _c : defaultMaxTokens;
            const maxIterations = (_d = spec.maxIterations) !== null && _d !== void 0 ? _d : defaultMaxIterations;
            const controller = new AbortController();
            const startedAt = clock();
            log('info', `[subagent] spawning ${id} role=${spec.role}`, { id, role: spec.role });
            const agentLogger = (lvl, msg, m) => log(lvl, `[subagent:${id}] ${msg}`, m);
            const promise = (() => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                _active.set(id, { controller, role: spec.role, startedAt, promise: null });
                try {
                    // Race runner against timeout
                    let timeoutHandle;
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutHandle = setTimeout(() => {
                            controller.abort();
                            reject(new Error('__timeout__'));
                        }, maxDurationMs);
                    });
                    let runnerResult;
                    try {
                        runnerResult = yield Promise.race([
                            opts.runner(Object.assign(Object.assign({}, spec), { id }), { signal: controller.signal, logger: agentLogger }),
                            timeoutPromise,
                        ]);
                    }
                    finally {
                        if (timeoutHandle !== undefined)
                            clearTimeout(timeoutHandle);
                    }
                    const durationMs = clock() - startedAt;
                    // Post-call budget checks
                    if (runnerResult.tokensUsed > maxTokens) {
                        log('warn', `[subagent] ${id} token budget exceeded`, {
                            tokensUsed: runnerResult.tokensUsed,
                            maxTokens,
                        });
                        (_a = opts.cost) === null || _a === void 0 ? void 0 : _a.record({
                            agentId: id,
                            role: spec.role,
                            tokens: runnerResult.tokensUsed,
                            usd: runnerResult.costUsd,
                        });
                        return {
                            id,
                            role: spec.role,
                            ok: false,
                            output: runnerResult.output,
                            toolCalls: runnerResult.toolCalls,
                            iterations: runnerResult.iterations,
                            durationMs,
                            tokensUsed: runnerResult.tokensUsed,
                            costUsd: runnerResult.costUsd,
                            error: 'token-budget-exceeded',
                            cancelled: false,
                        };
                    }
                    if (runnerResult.iterations > maxIterations) {
                        log('warn', `[subagent] ${id} iteration budget exceeded`, {
                            iterations: runnerResult.iterations,
                            maxIterations,
                        });
                        (_b = opts.cost) === null || _b === void 0 ? void 0 : _b.record({
                            agentId: id,
                            role: spec.role,
                            tokens: runnerResult.tokensUsed,
                            usd: runnerResult.costUsd,
                        });
                        return {
                            id,
                            role: spec.role,
                            ok: false,
                            output: runnerResult.output,
                            toolCalls: runnerResult.toolCalls,
                            iterations: runnerResult.iterations,
                            durationMs,
                            tokensUsed: runnerResult.tokensUsed,
                            costUsd: runnerResult.costUsd,
                            error: 'iteration-budget-exceeded',
                            cancelled: false,
                        };
                    }
                    (_c = opts.cost) === null || _c === void 0 ? void 0 : _c.record({
                        agentId: id,
                        role: spec.role,
                        tokens: runnerResult.tokensUsed,
                        usd: runnerResult.costUsd,
                    });
                    log('info', `[subagent] ${id} completed ok`, { durationMs });
                    return {
                        id,
                        role: spec.role,
                        ok: true,
                        output: runnerResult.output,
                        toolCalls: runnerResult.toolCalls,
                        iterations: runnerResult.iterations,
                        durationMs,
                        tokensUsed: runnerResult.tokensUsed,
                        costUsd: runnerResult.costUsd,
                    };
                }
                catch (err) {
                    const durationMs = clock() - startedAt;
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg === '__timeout__') {
                        log('warn', `[subagent] ${id} timed out after ${durationMs}ms`);
                        return {
                            id,
                            role: spec.role,
                            ok: false,
                            toolCalls: 0,
                            iterations: 0,
                            durationMs,
                            tokensUsed: 0,
                            error: 'timeout',
                            cancelled: false,
                        };
                    }
                    const wasCancelled = controller.signal.aborted && msg !== '__timeout__';
                    log(wasCancelled ? 'info' : 'error', `[subagent] ${id} ${wasCancelled ? 'cancelled' : 'failed'}`, { msg });
                    return {
                        id,
                        role: spec.role,
                        ok: false,
                        toolCalls: 0,
                        iterations: 0,
                        durationMs,
                        tokensUsed: 0,
                        error: wasCancelled ? 'cancelled' : msg,
                        cancelled: wasCancelled,
                    };
                }
                finally {
                    _active.delete(id);
                }
            }))();
            // Store promise reference back so active() can reflect it
            const entry = _active.get(id);
            if (entry) {
                entry.promise = promise;
            }
            _allPromises.add(promise);
            promise.finally(() => _allPromises.delete(promise));
            return promise;
        });
    }
    // ── spawnMany ─────────────────────────────────────────────────────────────
    function spawnMany(specs, spawnOpts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (specs.length === 0)
                return [];
            const mode = (_a = spawnOpts === null || spawnOpts === void 0 ? void 0 : spawnOpts.mode) !== null && _a !== void 0 ? _a : 'parallel';
            if (mode === 'serial') {
                const results = [];
                for (const spec of specs) {
                    results.push(yield spawn(spec));
                }
                return results;
            }
            // parallel — bounded by semaphore
            const promises = specs.map((spec) => __awaiter(this, void 0, void 0, function* () {
                yield semaphore.acquire();
                try {
                    return yield spawn(spec);
                }
                finally {
                    semaphore.release();
                }
            }));
            return Promise.all(promises);
        });
    }
    // ── cancel / cancelAll ────────────────────────────────────────────────────
    function cancel(id) {
        const entry = _active.get(id);
        if (!entry)
            return false;
        entry.controller.abort();
        return true;
    }
    function cancelAll() {
        var _a;
        const ids = [..._active.keys()];
        for (const id of ids) {
            (_a = _active.get(id)) === null || _a === void 0 ? void 0 : _a.controller.abort();
        }
        return ids.length;
    }
    // ── active ────────────────────────────────────────────────────────────────
    function active() {
        return [..._active.entries()].map(([id, { role, startedAt }]) => ({
            id,
            role,
            startedAt,
        }));
    }
    // ── shutdown ──────────────────────────────────────────────────────────────
    function shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            if (_isShutdown)
                return;
            _isShutdown = true;
            cancelAll();
            // Wait for all in-flight promises to settle
            const pending = [..._allPromises];
            yield Promise.allSettled(pending);
        });
    }
    return { spawn, spawnMany, cancel, cancelAll, active, shutdown };
}
