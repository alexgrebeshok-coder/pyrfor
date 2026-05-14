/**
 * pyrfor-fc-circuit-router.ts
 *
 * Wraps runFreeClaude with per-model circuit breakers.
 * Iterates modelChain in order; skips open circuits, records failures,
 * and calls onFailover when switching models.
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { runFreeClaude } from './pyrfor-fc-adapter.js';
import { CircuitOpenError, getCircuitBreaker } from '../ai/circuit-breaker.js';
/** Returns true if the envelope indicates a provider-side failure. */
function isFailure(env) {
    var _a, _b;
    if (env.status !== 'success')
        return true;
    const stop = ((_a = env.stopReason) !== null && _a !== void 0 ? _a : '').toLowerCase();
    const err = ((_b = env.error) !== null && _b !== void 0 ? _b : '').toLowerCase();
    if (stop.includes('overloaded') || stop.includes('rate_limit') || stop.includes('rate limit'))
        return true;
    if (err.includes('429') || err.includes('rate') || err.includes('overload'))
        return true;
    return false;
}
function syntheticError(error) {
    return {
        status: 'error',
        error,
        exitCode: -1,
        filesTouched: [],
        commandsRun: [],
        raw: {},
    };
}
class TerminalCircuitAttemptError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TerminalCircuitAttemptError';
    }
}
/**
 * Try modelChain in order, with per-model circuit breakers.
 *
 * - Circuit open → skip (attempt recorded as 'circuit_open').
 * - Failure envelope → record breaker failure, try next.
 * - Success → record breaker success, return.
 * - All exhausted → return last captured envelope (or synthetic error if all open).
 */
export function runFreeClaudeWithCircuit(opts, router) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield createFreeClaudeCircuitHandle(opts, router).completeCircuit();
        return {
            envelope: result.envelope,
            modelUsed: result.modelUsed,
            attempts: result.attempts,
        };
    });
}
export function createFreeClaudeCircuitHandle(opts, router) {
    const { modelChain, failureThreshold = 3, cooldownMs = 30000, runFn = runFreeClaude, getBreaker = (name, bOpts) => getCircuitBreaker(name, bOpts), logger, onFailover, beforeAttempt, validateEvent, onAttemptComplete, } = router;
    const attempts = [];
    let lastEnvelope = null;
    let currentHandle = null;
    let abortReason = null;
    let routedPromise = null;
    let replayEvents = [];
    const runAttempt = (model, attemptIndex) => __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d;
        if (abortReason) {
            throw new TerminalCircuitAttemptError(abortReason);
        }
        const ctx = { model, attemptIndex };
        try {
            yield (beforeAttempt === null || beforeAttempt === void 0 ? void 0 : beforeAttempt(ctx));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const terminal = new TerminalCircuitAttemptError(message);
            if (err instanceof Error)
                terminal.stack = err.stack;
            throw terminal;
        }
        const handle = runFn(Object.assign(Object.assign({}, opts), { model }));
        currentHandle = handle;
        const events = [];
        try {
            try {
                for (var _e = true, _f = __asyncValues(handle.events()), _g; _g = yield _f.next(), _a = _g.done, !_a; _e = true) {
                    _c = _g.value;
                    _e = false;
                    const event = _c;
                    if (abortReason) {
                        handle.abort(abortReason);
                        throw new TerminalCircuitAttemptError(abortReason);
                    }
                    try {
                        yield (validateEvent === null || validateEvent === void 0 ? void 0 : validateEvent(event, ctx));
                    }
                    catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        handle.abort(message);
                        const terminal = new TerminalCircuitAttemptError(message);
                        if (err instanceof Error)
                            terminal.stack = err.stack;
                        throw terminal;
                    }
                    events.push(event);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_e && !_a && (_b = _f.return)) yield _b.call(_f);
                }
                finally { if (e_1) throw e_1.error; }
            }
            const result = yield handle.complete();
            yield (onAttemptComplete === null || onAttemptComplete === void 0 ? void 0 : onAttemptComplete(result, ctx));
            if (isFailure(result.envelope)) {
                throw new Error((_d = result.envelope.error) !== null && _d !== void 0 ? _d : `FC run failed with status: ${result.envelope.status}`);
            }
            return { result, events };
        }
        catch (err) {
            if (err instanceof TerminalCircuitAttemptError) {
                throw err;
            }
            if (abortReason) {
                throw new TerminalCircuitAttemptError(abortReason);
            }
            throw err;
        }
        finally {
            if (currentHandle === handle) {
                currentHandle = null;
            }
        }
    });
    const runRouted = () => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (modelChain.length === 0) {
            const envelope = syntheticError('no FreeClaude circuit models configured');
            return { envelope, modelUsed: 'unknown', attempts, events: [], exitCode: envelope.exitCode };
        }
        for (let i = 0; i < modelChain.length; i++) {
            const model = modelChain[i];
            const nextModel = modelChain[i + 1];
            const breaker = getBreaker(`fc-model-${model}`, {
                failureThreshold,
                resetTimeout: cooldownMs,
            });
            let capturedEnvelope = null;
            try {
                const attempt = yield breaker.execute(() => __awaiter(this, void 0, void 0, function* () {
                    const attemptResult = yield runAttempt(model, i);
                    capturedEnvelope = attemptResult.result.envelope;
                    return attemptResult;
                }), {
                    ignoreError: (err) => err instanceof TerminalCircuitAttemptError,
                });
                attempts.push({ model, status: 'success' });
                replayEvents = attempt.events;
                logger === null || logger === void 0 ? void 0 : logger('info', `FC circuit router: success with model ${model}`, { model });
                return {
                    envelope: attempt.result.envelope,
                    modelUsed: model,
                    attempts,
                    events: attempt.events,
                    exitCode: attempt.result.exitCode,
                };
            }
            catch (err) {
                if (err instanceof TerminalCircuitAttemptError) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    attempts.push({ model, status: 'failure', error: errMsg });
                    const envelope = syntheticError(errMsg);
                    logger === null || logger === void 0 ? void 0 : logger('error', `FC circuit router: terminal failure with ${model}: ${errMsg}`, { model });
                    return { envelope, modelUsed: model, attempts, events: [], exitCode: envelope.exitCode };
                }
                if (err instanceof CircuitOpenError) {
                    const errMsg = err.message;
                    attempts.push({ model, status: 'circuit_open', error: errMsg });
                    logger === null || logger === void 0 ? void 0 : logger('warn', `FC circuit router: circuit open for ${model}`, { model });
                    if (nextModel !== undefined) {
                        onFailover === null || onFailover === void 0 ? void 0 : onFailover(model, nextModel, errMsg);
                    }
                    continue;
                }
                const errMsg = err instanceof Error ? err.message : String(err);
                attempts.push({ model, status: 'failure', error: errMsg });
                logger === null || logger === void 0 ? void 0 : logger('warn', `FC circuit router: failure with model ${model}: ${errMsg}`, { model });
                lastEnvelope = capturedEnvelope !== null && capturedEnvelope !== void 0 ? capturedEnvelope : syntheticError(errMsg);
                if (nextModel !== undefined) {
                    onFailover === null || onFailover === void 0 ? void 0 : onFailover(model, nextModel, errMsg);
                }
            }
        }
        const finalEnvelope = lastEnvelope !== null && lastEnvelope !== void 0 ? lastEnvelope : syntheticError('all models exhausted (all circuits open)');
        const lastAttempt = attempts[attempts.length - 1];
        return {
            envelope: finalEnvelope,
            modelUsed: (_b = (_a = lastAttempt === null || lastAttempt === void 0 ? void 0 : lastAttempt.model) !== null && _a !== void 0 ? _a : modelChain[0]) !== null && _b !== void 0 ? _b : 'unknown',
            attempts,
            events: [],
            exitCode: finalEnvelope.exitCode,
        };
    });
    const ensureRouted = () => {
        routedPromise !== null && routedPromise !== void 0 ? routedPromise : (routedPromise = runRouted());
        return routedPromise;
    };
    return {
        events() {
            return __asyncGenerator(this, arguments, function* events_1() {
                const result = yield __await(ensureRouted());
                for (const event of result.events) {
                    yield yield __await(event);
                }
            });
        },
        complete() {
            return __awaiter(this, void 0, void 0, function* () {
                const result = yield ensureRouted();
                return {
                    envelope: result.envelope,
                    events: [...replayEvents],
                    exitCode: result.exitCode,
                };
            });
        },
        completeCircuit() {
            return __awaiter(this, void 0, void 0, function* () {
                return ensureRouted();
            });
        },
        abort(reason) {
            abortReason = reason !== null && reason !== void 0 ? reason : 'aborted';
            currentHandle === null || currentHandle === void 0 ? void 0 : currentHandle.abort(abortReason);
        },
    };
}
