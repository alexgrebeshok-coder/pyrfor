/**
 * Generic retry / backoff / timeout / jitter wrapper.
 *
 * Inject `setTimer`, `clearTimer`, `rng`, and `clock` for deterministic tests.
 * No external dependencies.
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
// ---------------------------------------------------------------------------
// Delay computation
// ---------------------------------------------------------------------------
function computeBaseDelay(attempt, baseDelayMs, maxDelayMs, backoff) {
    let d;
    if (backoff === 'exponential') {
        d = baseDelayMs * Math.pow(2, attempt - 1);
    }
    else if (backoff === 'linear') {
        d = baseDelayMs * attempt;
    }
    else {
        d = baseDelayMs;
    }
    return Math.min(d, maxDelayMs);
}
function applyJitter(delay, jitter, rng) {
    if (jitter === 'full')
        return rng() * delay;
    if (jitter === 'equal')
        return delay / 2 + rng() * (delay / 2);
    return delay;
}
// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------
export function withRetry(fn, policy) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const maxAttempts = (_a = policy === null || policy === void 0 ? void 0 : policy.maxAttempts) !== null && _a !== void 0 ? _a : 3;
        const baseDelayMs = (_b = policy === null || policy === void 0 ? void 0 : policy.baseDelayMs) !== null && _b !== void 0 ? _b : 200;
        const maxDelayMs = (_c = policy === null || policy === void 0 ? void 0 : policy.maxDelayMs) !== null && _c !== void 0 ? _c : 10000;
        const backoff = (_d = policy === null || policy === void 0 ? void 0 : policy.backoff) !== null && _d !== void 0 ? _d : 'exponential';
        const jitter = (_e = policy === null || policy === void 0 ? void 0 : policy.jitter) !== null && _e !== void 0 ? _e : 'full';
        const retryOn = (_f = policy === null || policy === void 0 ? void 0 : policy.retryOn) !== null && _f !== void 0 ? _f : (() => true);
        const timeoutMs = policy === null || policy === void 0 ? void 0 : policy.timeoutMs;
        const onAttempt = policy === null || policy === void 0 ? void 0 : policy.onAttempt;
        const outerSignal = policy === null || policy === void 0 ? void 0 : policy.signal;
        const setTimer = (_g = policy === null || policy === void 0 ? void 0 : policy.setTimer) !== null && _g !== void 0 ? _g : ((cb, ms) => globalThis.setTimeout(cb, ms));
        const clearTimer = (_h = policy === null || policy === void 0 ? void 0 : policy.clearTimer) !== null && _h !== void 0 ? _h : ((h) => globalThis.clearTimeout(h));
        const rng = (_j = policy === null || policy === void 0 ? void 0 : policy.rng) !== null && _j !== void 0 ? _j : Math.random;
        // Throw immediately if outer signal is already aborted.
        if (outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.aborted) {
            throw (_k = outerSignal.reason) !== null && _k !== void 0 ? _k : new DOMException('Aborted', 'AbortError');
        }
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Check outer abort before each attempt.
            if (outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.aborted) {
                throw (_l = outerSignal.reason) !== null && _l !== void 0 ? _l : new DOMException('Aborted', 'AbortError');
            }
            let attemptError;
            try {
                let attemptSignal;
                let timeoutAbortController;
                if (timeoutMs !== undefined) {
                    timeoutAbortController = new AbortController();
                    attemptSignal = timeoutAbortController.signal;
                }
                // If there's an outer signal, combine it with the per-attempt signal.
                // We create a merged signal so the fn sees one AbortSignal.
                let signalForFn;
                if (timeoutAbortController && outerSignal) {
                    const merged = new AbortController();
                    const abortMerged = () => merged.abort(outerSignal.reason);
                    const abortMergedTimeout = () => merged.abort(timeoutAbortController.signal.reason);
                    if (outerSignal.aborted) {
                        merged.abort(outerSignal.reason);
                    }
                    else {
                        outerSignal.addEventListener('abort', abortMerged, { once: true });
                        timeoutAbortController.signal.addEventListener('abort', abortMergedTimeout, { once: true });
                    }
                    signalForFn = merged.signal;
                }
                else if (timeoutAbortController) {
                    signalForFn = timeoutAbortController.signal;
                }
                else {
                    signalForFn = outerSignal;
                }
                if (timeoutMs !== undefined && timeoutAbortController) {
                    // Race fn() against a timeout promise.
                    let timeoutHandle;
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutHandle = setTimer(() => {
                            timeoutAbortController.abort(new DOMException('Attempt timed out', 'TimeoutError'));
                            reject(new DOMException('Attempt timed out', 'TimeoutError'));
                        }, timeoutMs);
                    });
                    try {
                        const result = yield Promise.race([fn(attempt, signalForFn), timeoutPromise]);
                        clearTimer(timeoutHandle);
                        onAttempt === null || onAttempt === void 0 ? void 0 : onAttempt({ attempt });
                        return result;
                    }
                    catch (err) {
                        clearTimer(timeoutHandle);
                        throw err;
                    }
                }
                else {
                    const result = yield fn(attempt, signalForFn);
                    onAttempt === null || onAttempt === void 0 ? void 0 : onAttempt({ attempt });
                    return result;
                }
            }
            catch (err) {
                attemptError = err;
                lastError = err;
                // If outer signal fired, propagate abort immediately.
                if (outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.aborted) {
                    onAttempt === null || onAttempt === void 0 ? void 0 : onAttempt({ attempt, err });
                    throw (_m = outerSignal.reason) !== null && _m !== void 0 ? _m : err;
                }
                const isLastAttempt = attempt >= maxAttempts;
                const shouldRetry = !isLastAttempt && retryOn(err, attempt);
                if (!shouldRetry) {
                    onAttempt === null || onAttempt === void 0 ? void 0 : onAttempt({ attempt, err });
                    throw err;
                }
                // Compute delay for next attempt.
                const baseDelay = computeBaseDelay(attempt, baseDelayMs, maxDelayMs, backoff);
                const delayMs = applyJitter(baseDelay, jitter, rng);
                onAttempt === null || onAttempt === void 0 ? void 0 : onAttempt({ attempt, err, delayMs });
                // Sleep with outer-signal cancellation support.
                yield new Promise((resolve, reject) => {
                    var _a;
                    let handle;
                    const onAbort = () => {
                        var _a;
                        clearTimer(handle);
                        reject((_a = outerSignal.reason) !== null && _a !== void 0 ? _a : new DOMException('Aborted', 'AbortError'));
                    };
                    handle = setTimer(() => {
                        outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.removeEventListener('abort', onAbort);
                        resolve();
                    }, delayMs);
                    if (outerSignal) {
                        if (outerSignal.aborted) {
                            clearTimer(handle);
                            reject((_a = outerSignal.reason) !== null && _a !== void 0 ? _a : new DOMException('Aborted', 'AbortError'));
                        }
                        else {
                            outerSignal.addEventListener('abort', onAbort, { once: true });
                        }
                    }
                });
            }
        }
        throw lastError;
    });
}
// ---------------------------------------------------------------------------
// tryRetry — never throws
// ---------------------------------------------------------------------------
export function tryRetry(fn, policy) {
    return __awaiter(this, void 0, void 0, function* () {
        // We need attempt count even on failure; instrument onAttempt.
        let attempts = 0;
        const originalOnAttempt = policy === null || policy === void 0 ? void 0 : policy.onAttempt;
        const wrapped = Object.assign(Object.assign({}, policy), { onAttempt(info) {
                attempts = info.attempt;
                originalOnAttempt === null || originalOnAttempt === void 0 ? void 0 : originalOnAttempt(info);
            } });
        try {
            const value = yield withRetry(fn, wrapped);
            return { ok: true, value, attempts };
        }
        catch (error) {
            return { ok: false, error, attempts };
        }
    });
}
// ---------------------------------------------------------------------------
// makeRetryWrapper — partial-application helper
// ---------------------------------------------------------------------------
export function makeRetryWrapper(defaults) {
    return (fn, policy) => withRetry(fn, Object.assign(Object.assign({}, defaults), policy));
}
