/**
 * Circuit Breaker Pattern
 * 
 * Prevents cascade failures in distributed systems
 */

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    message = 'Circuit breaker is open'
  ) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Failures before opening (default: 3)
  resetTimeout: number; // ms before trying again (default: 60_000)
  halfOpenMax: number; // Successes needed to close (default: 2)
  executionTimeoutMs: number; // Max execution time before counting as failure
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

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private halfOpenProbeInFlight = false;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRejections = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {
      failureThreshold: 3,
      resetTimeout: 60_000,
      halfOpenMax: 2,
      executionTimeoutMs: 45_000,
    }
  ) {}

  async execute<T>(
    fn: () => Promise<T>,
    executionOptions: CircuitBreakerExecutionOptions = {}
  ): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
        this.state = 'half-open';
        this.successCount = 0;
      } else {
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
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      this.halfOpenProbeInFlight = false;
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenMax) {
        this.state = 'closed';
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }

  snapshot(): CircuitBreakerSnapshot {
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

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    this.halfOpenProbeInFlight = false;
  }
}

// Singleton registry for circuit breakers
export const circuitBreakers = new Map<string, CircuitBreaker>();

/** Observability helper — returns a snapshot of every registered breaker. */
export function getAllCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return Array.from(circuitBreakers.values()).map((b) => b.snapshot());
}

export function getCircuitBreaker(
  name: string,
  options?: Partial<CircuitBreakerOptions>
): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(
      name,
      new CircuitBreaker(name, {
        failureThreshold: options?.failureThreshold ?? 3,
        resetTimeout: options?.resetTimeout ?? 60_000,
        halfOpenMax: options?.halfOpenMax ?? 2,
        executionTimeoutMs: options?.executionTimeoutMs ?? 45_000,
      })
    );
  }
  return circuitBreakers.get(name)!;
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  circuitName: string
): Promise<T> {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Circuit timeout (${circuitName}) after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
