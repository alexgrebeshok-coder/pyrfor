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
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {
      failureThreshold: 3,
      resetTimeout: 60_000,
      halfOpenMax: 2,
    }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
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
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
  }
}

// Singleton registry for circuit breakers
export const circuitBreakers = new Map<string, CircuitBreaker>();

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
      })
    );
  }
  return circuitBreakers.get(name)!;
}
