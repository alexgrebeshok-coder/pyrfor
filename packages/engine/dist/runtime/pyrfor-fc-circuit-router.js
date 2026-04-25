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
        var _a, _b;
        const { modelChain, failureThreshold = 3, cooldownMs = 30000, runFn = runFreeClaude, getBreaker = (name, bOpts) => getCircuitBreaker(name, bOpts), logger, onFailover, } = router;
        const attempts = [];
        let lastEnvelope = null;
        for (let i = 0; i < modelChain.length; i++) {
            const model = modelChain[i];
            const nextModel = modelChain[i + 1];
            const breaker = getBreaker(`fc-model-${model}`, {
                failureThreshold,
                resetTimeout: cooldownMs,
            });
            let capturedEnvelope = null;
            try {
                const envelope = yield breaker.execute(() => __awaiter(this, void 0, void 0, function* () {
                    var _a;
                    const handle = runFn(Object.assign(Object.assign({}, opts), { model }));
                    const result = yield handle.complete();
                    capturedEnvelope = result.envelope;
                    if (isFailure(result.envelope)) {
                        throw new Error((_a = result.envelope.error) !== null && _a !== void 0 ? _a : `FC run failed with status: ${result.envelope.status}`);
                    }
                    return result.envelope;
                }));
                // ── Success ────────────────────────────────────────────────────────────
                attempts.push({ model, status: 'success' });
                logger === null || logger === void 0 ? void 0 : logger('info', `FC circuit router: success with model ${model}`, { model });
                return { envelope, modelUsed: model, attempts };
            }
            catch (err) {
                if (err instanceof CircuitOpenError) {
                    // ── Circuit open ───────────────────────────────────────────────────
                    const errMsg = err.message;
                    attempts.push({ model, status: 'circuit_open', error: errMsg });
                    logger === null || logger === void 0 ? void 0 : logger('warn', `FC circuit router: circuit open for ${model}`, { model });
                    if (nextModel !== undefined) {
                        onFailover === null || onFailover === void 0 ? void 0 : onFailover(model, nextModel, errMsg);
                    }
                }
                else {
                    // ── Failure ────────────────────────────────────────────────────────
                    const errMsg = err instanceof Error ? err.message : String(err);
                    attempts.push({ model, status: 'failure', error: errMsg });
                    logger === null || logger === void 0 ? void 0 : logger('warn', `FC circuit router: failure with model ${model}: ${errMsg}`, { model });
                    lastEnvelope = capturedEnvelope !== null && capturedEnvelope !== void 0 ? capturedEnvelope : syntheticError(errMsg);
                    if (nextModel !== undefined) {
                        onFailover === null || onFailover === void 0 ? void 0 : onFailover(model, nextModel, errMsg);
                    }
                }
            }
        }
        // ── All models exhausted ───────────────────────────────────────────────────
        const finalEnvelope = lastEnvelope !== null && lastEnvelope !== void 0 ? lastEnvelope : syntheticError('all models exhausted (all circuits open)');
        const lastAttempt = attempts[attempts.length - 1];
        return {
            envelope: finalEnvelope,
            modelUsed: (_b = (_a = lastAttempt === null || lastAttempt === void 0 ? void 0 : lastAttempt.model) !== null && _a !== void 0 ? _a : modelChain[0]) !== null && _b !== void 0 ? _b : 'unknown',
            attempts,
        };
    });
}
