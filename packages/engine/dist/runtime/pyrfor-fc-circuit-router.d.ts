/**
 * pyrfor-fc-circuit-router.ts
 *
 * Wraps runFreeClaude with per-model circuit breakers.
 * Iterates modelChain in order; skips open circuits, records failures,
 * and calls onFailover when switching models.
 */
import type { FCRunOptions, FCHandle, FCEnvelope, FCEvent, FCRunResult } from './pyrfor-fc-adapter';
import { CircuitBreaker } from '../ai/circuit-breaker';
export interface FcCircuitRouterOptions {
    /** Ordered chain of models. First non-tripped model wins; fallbacks on circuit open. */
    modelChain: string[];
    /** Failure threshold per model circuit. Default: 3. */
    failureThreshold?: number;
    /** Cooldown ms before half-open. Default: 30000. */
    cooldownMs?: number;
    /** Adapter spawner. Default: runFreeClaude. */
    runFn?: (opts: FCRunOptions) => FCHandle;
    /** Custom CircuitBreaker factory for tests. */
    getBreaker?: (name: string, opts: any) => CircuitBreaker;
    /** Logger. */
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
    /** Called when failover occurs (from one model to the next). */
    onFailover?: (fromModel: string, toModel: string, reason: string) => void;
    /** Called before spawning each model attempt. Throws are terminal. */
    beforeAttempt?: (ctx: FcCircuitAttemptContext) => void | Promise<void>;
    /** Validate buffered events before any successful attempt is replayed. Throws are terminal. */
    validateEvent?: (event: FCEvent, ctx: FcCircuitAttemptContext) => void | Promise<void>;
    /** Called after each attempt completes, including failed attempts. */
    onAttemptComplete?: (result: FCRunResult, ctx: FcCircuitAttemptContext) => void | Promise<void>;
}
export interface CircuitRoutedResult {
    envelope: FCEnvelope;
    modelUsed: string;
    attempts: Array<{
        model: string;
        status: 'success' | 'failure' | 'circuit_open';
        error?: string;
    }>;
}
export interface FcCircuitAttemptContext {
    model: string;
    attemptIndex: number;
}
export interface FCCircuitHandle extends FCHandle {
    completeCircuit(): Promise<CircuitRoutedResult & {
        events: FCEvent[];
        exitCode: number;
    }>;
}
/**
 * Try modelChain in order, with per-model circuit breakers.
 *
 * - Circuit open → skip (attempt recorded as 'circuit_open').
 * - Failure envelope → record breaker failure, try next.
 * - Success → record breaker success, return.
 * - All exhausted → return last captured envelope (or synthetic error if all open).
 */
export declare function runFreeClaudeWithCircuit(opts: FCRunOptions, router: FcCircuitRouterOptions): Promise<CircuitRoutedResult>;
export declare function createFreeClaudeCircuitHandle(opts: FCRunOptions, router: FcCircuitRouterOptions): FCCircuitHandle;
//# sourceMappingURL=pyrfor-fc-circuit-router.d.ts.map