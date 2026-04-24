/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures in distributed systems
 */
type CircuitState = 'closed' | 'open' | 'half-open';
export declare class CircuitOpenError extends Error {
    readonly circuitName: string;
    constructor(circuitName: string, message?: string);
}
export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    halfOpenMax: number;
    executionTimeoutMs: number;
}
export interface CircuitBreakerExecutionOptions {
    timeoutMs?: number;
}
export interface CircuitBreakerSnapshot {
    name: string;
    state: CircuitState;
    failures: number;
    lastFailureTime: number;
    totalFailures: number;
    totalSuccesses: number;
    totalRejections: number;
}
export declare class CircuitBreaker {
    private readonly name;
    private readonly options;
    private state;
    private failures;
    private lastFailureTime;
    private successCount;
    private halfOpenProbeInFlight;
    private totalFailures;
    private totalSuccesses;
    private totalRejections;
    constructor(name: string, options?: CircuitBreakerOptions);
    execute<T>(fn: () => Promise<T>, executionOptions?: CircuitBreakerExecutionOptions): Promise<T>;
    private onSuccess;
    private onFailure;
    getState(): {
        state: CircuitState;
        failures: number;
    };
    snapshot(): CircuitBreakerSnapshot;
    reset(): void;
}
export declare const circuitBreakers: Map<string, CircuitBreaker>;
/** Observability helper — returns a snapshot of every registered breaker. */
export declare function getAllCircuitBreakerSnapshots(): CircuitBreakerSnapshot[];
export declare function getCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker;
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map