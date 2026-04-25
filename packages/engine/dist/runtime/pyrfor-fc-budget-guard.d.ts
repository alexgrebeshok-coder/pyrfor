/**
 * pyrfor-fc-budget-guard.ts
 *
 * Wraps runFreeClaude with pre-flight and periodic token-budget checks.
 * Pre-flight denied → return synthetic error envelope, FC never spawned.
 * Mid-run periodic check denied → abort FC, return error envelope.
 * On completion → record actual consumption via controller.recordConsumption.
 */
import type { FCRunOptions, FCHandle, FCEnvelope } from './pyrfor-fc-adapter';
import type { TokenBudgetController, BudgetScope } from './token-budget-controller';
export interface FcBudgetGuardOptions {
    controller: TokenBudgetController;
    scope: BudgetScope;
    scopeId?: string;
    /** Pre-flight token estimate. Default: 8192 prompt + 4096 completion. */
    preflightEstimate?: {
        promptTokens: number;
        completionTokens: number;
    };
    /** Interval (ms) for mid-run canConsume checks. 0 disables. Default: 10000. */
    checkIntervalMs?: number;
    /** Adapter spawner for tests. Default: runFreeClaude. */
    runFn?: (opts: FCRunOptions) => FCHandle;
    /** Clock. */
    now?: () => number;
    /** Logger. */
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
    /** Called when budget aborts the run. */
    onBudgetAbort?: (reason: string) => void;
}
/**
 * Spawn FC under budget supervision.
 *
 * 1. Pre-check canConsume with preflight estimate. Denied → return error envelope.
 * 2. Spawn FC; periodically re-check canConsume. Denied → abort + return error envelope.
 * 3. Final canConsume check with actual tokens (provides the "pre + final" count when periodic=0).
 * 4. Record actual consumption via recordConsumption.
 */
export declare function runFreeClaudeWithBudget(opts: FCRunOptions, guard: FcBudgetGuardOptions): Promise<FCEnvelope>;
//# sourceMappingURL=pyrfor-fc-budget-guard.d.ts.map