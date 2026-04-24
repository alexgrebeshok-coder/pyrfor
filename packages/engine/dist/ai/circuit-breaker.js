/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures in distributed systems
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
export class CircuitOpenError extends Error {
    constructor(circuitName, message = 'Circuit breaker is open') {
        super(message);
        this.circuitName = circuitName;
        this.name = 'CircuitOpenError';
    }
}
export class CircuitBreaker {
    constructor(name, options = {
        failureThreshold: 3,
        resetTimeout: 60000,
        halfOpenMax: 2,
        executionTimeoutMs: 45000,
    }) {
        this.name = name;
        this.options = options;
        this.state = 'closed';
        this.failures = 0;
        this.lastFailureTime = 0;
        this.successCount = 0;
        this.halfOpenProbeInFlight = false;
        this.totalFailures = 0;
        this.totalSuccesses = 0;
        this.totalRejections = 0;
    }
    execute(fn_1) {
        return __awaiter(this, arguments, void 0, function* (fn, executionOptions = {}) {
            var _a;
            if (this.state === 'open') {
                if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
                    this.state = 'half-open';
                    this.successCount = 0;
                }
                else {
                    this.totalRejections++;
                    throw new CircuitOpenError(this.name);
                }
            }
            if (this.state === 'half-open') {
                if (this.halfOpenProbeInFlight) {
                    this.totalRejections++;
                    throw new CircuitOpenError(this.name, 'Circuit breaker is half-open and probe is already in flight');
                }
                this.halfOpenProbeInFlight = true;
            }
            const timeoutMs = (_a = executionOptions.timeoutMs) !== null && _a !== void 0 ? _a : this.options.executionTimeoutMs;
            try {
                const result = yield promiseWithTimeout(fn(), timeoutMs, this.name);
                this.onSuccess();
                return result;
            }
            catch (error) {
                this.onFailure();
                throw error;
            }
            finally {
                this.halfOpenProbeInFlight = false;
            }
        });
    }
    onSuccess() {
        this.totalSuccesses++;
        if (this.state === 'half-open') {
            this.successCount++;
            if (this.successCount >= this.options.halfOpenMax) {
                this.state = 'closed';
                this.failures = 0;
            }
        }
        else {
            this.failures = 0;
        }
    }
    onFailure() {
        this.totalFailures++;
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.options.failureThreshold) {
            this.state = 'open';
        }
    }
    getState() {
        return { state: this.state, failures: this.failures };
    }
    snapshot() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
            totalFailures: this.totalFailures,
            totalSuccesses: this.totalSuccesses,
            totalRejections: this.totalRejections,
        };
    }
    reset() {
        this.state = 'closed';
        this.failures = 0;
        this.successCount = 0;
        this.halfOpenProbeInFlight = false;
    }
}
// Singleton registry for circuit breakers
export const circuitBreakers = new Map();
/** Observability helper — returns a snapshot of every registered breaker. */
export function getAllCircuitBreakerSnapshots() {
    return Array.from(circuitBreakers.values()).map((b) => b.snapshot());
}
export function getCircuitBreaker(name, options) {
    var _a, _b, _c, _d;
    if (!circuitBreakers.has(name)) {
        circuitBreakers.set(name, new CircuitBreaker(name, {
            failureThreshold: (_a = options === null || options === void 0 ? void 0 : options.failureThreshold) !== null && _a !== void 0 ? _a : 3,
            resetTimeout: (_b = options === null || options === void 0 ? void 0 : options.resetTimeout) !== null && _b !== void 0 ? _b : 60000,
            halfOpenMax: (_c = options === null || options === void 0 ? void 0 : options.halfOpenMax) !== null && _c !== void 0 ? _c : 2,
            executionTimeoutMs: (_d = options === null || options === void 0 ? void 0 : options.executionTimeoutMs) !== null && _d !== void 0 ? _d : 45000,
        }));
    }
    return circuitBreakers.get(name);
}
function promiseWithTimeout(promise, timeoutMs, circuitName) {
    if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
        return promise;
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Circuit timeout (${circuitName}) after ${timeoutMs}ms`));
        }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
