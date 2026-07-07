/**
 * Run-level budget guard for self-improvement (MetaCritic) runs.
 *
 * Reuses TokenBudgetController pre-check patterns from pyrfor-fc-budget-guard.
 */
import type { EventLedger } from './event-ledger';
import type { BudgetScope, TokenBudgetController } from './token-budget-controller';
export interface RunBudgetPolicy {
    scope?: BudgetScope;
    maxCostUsd?: number;
    maxTokens?: number;
    preflightEstimate?: {
        promptTokens: number;
        completionTokens: number;
        costUsd?: number;
    };
}
export interface RunBudgetCheckResult {
    allowed: boolean;
    reason?: string;
    blockingRule?: string;
}
export declare function checkRunBudget(controller: TokenBudgetController, runId: string, policy?: RunBudgetPolicy): RunBudgetCheckResult;
export declare function abortRunForBudget(ledger: EventLedger, runId: string, reason: string): Promise<void>;
export interface MetaCriticRunBudgetGuard {
    controller: TokenBudgetController;
    policy?: RunBudgetPolicy;
    ledger: EventLedger;
}
export declare function assertMetaCriticRunBudget(guard: MetaCriticRunBudgetGuard, runId: string): Promise<void>;
//# sourceMappingURL=si-run-budget-guard.d.ts.map