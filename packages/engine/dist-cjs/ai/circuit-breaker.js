"use strict";
/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures in distributed systems
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuitBreakers = exports.CircuitBreaker = exports.CircuitOpenError = void 0;
exports.getAllCircuitBreakerSnapshots = getAllCircuitBreakerSnapshots;
exports.getCircuitBreaker = getCircuitBreaker;
class CircuitOpenError extends Error {
    constructor(circuitName, message = 'Circuit breaker is open') {
        super(message);
        this.circuitName = circuitName;
        this.name = 'CircuitOpenError';
    }
}
exports.CircuitOpenError = CircuitOpenError;
class CircuitBreaker {
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
    async execute(fn, executionOptions = {}) {
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
        const timeoutMs = executionOptions.timeoutMs ?? this.options.executionTimeoutMs;
        try {
            const result = await promiseWithTimeout(fn(), timeoutMs, this.name);
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
exports.CircuitBreaker = CircuitBreaker;
// Singleton registry for circuit breakers
exports.circuitBreakers = new Map();
/** Observability helper — returns a snapshot of every registered breaker. */
function getAllCircuitBreakerSnapshots() {
    return Array.from(exports.circuitBreakers.values()).map((b) => b.snapshot());
}
function getCircuitBreaker(name, options) {
    if (!exports.circuitBreakers.has(name)) {
        exports.circuitBreakers.set(name, new CircuitBreaker(name, {
            failureThreshold: options?.failureThreshold ?? 3,
            resetTimeout: options?.resetTimeout ?? 60000,
            halfOpenMax: options?.halfOpenMax ?? 2,
            executionTimeoutMs: options?.executionTimeoutMs ?? 45000,
        }));
    }
    return exports.circuitBreakers.get(name);
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
