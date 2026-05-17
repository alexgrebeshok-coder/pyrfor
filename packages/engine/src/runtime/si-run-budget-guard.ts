/**
 * Run-level budget guard for self-improvement (MetaCritic) runs.
 *
 * Reuses TokenBudgetController pre-check patterns from pyrfor-fc-budget-guard.
 */

import type { EventLedger } from './event-ledger';
import type { BudgetScope, CanConsumeResult, TokenBudgetController } from './token-budget-controller';

export interface RunBudgetPolicy {
  scope?: BudgetScope;
  maxCostUsd?: number;
  maxTokens?: number;
  preflightEstimate?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

export interface RunBudgetCheckResult {
  allowed: boolean;
  reason?: string;
  blockingRule?: string;
}

export function checkRunBudget(
  controller: TokenBudgetController,
  runId: string,
  policy: RunBudgetPolicy = {},
): RunBudgetCheckResult {
  const scope = policy.scope ?? 'task';
  const preflight = policy.preflightEstimate ?? { promptTokens: 4096, completionTokens: 2048, costUsd: 0.01 };
  const check: CanConsumeResult = controller.canConsume({
    scope,
    targetId: runId,
    estPromptTokens: preflight.promptTokens,
    estCompletionTokens: preflight.completionTokens,
    estCostUsd: preflight.costUsd ?? 0,
  });

  if (!check.allowed) {
    return {
      allowed: false,
      reason: `budget denied: ${check.blockingRule ?? 'limit exceeded'}`,
      blockingRule: check.blockingRule,
    };
  }

  if (policy.maxCostUsd !== undefined) {
    const snapshot = controller.reportSnapshot();
    if (snapshot.totalCostUsd > policy.maxCostUsd) {
      return { allowed: false, reason: 'budget denied: run maxCostUsd exceeded' };
    }
  }

  if (policy.maxTokens !== undefined) {
    const snapshot = controller.reportSnapshot();
    const totalTokens = snapshot.rules.reduce((sum, row) => sum + row.usage.tokens, 0);
    if (totalTokens > policy.maxTokens) {
      return { allowed: false, reason: 'budget denied: run maxTokens exceeded' };
    }
  }

  return { allowed: true };
}

export async function abortRunForBudget(
  ledger: EventLedger,
  runId: string,
  reason: string,
): Promise<void> {
  await ledger.append({
    type: 'run.blocked',
    run_id: runId,
    reason,
  });
}

export interface MetaCriticRunBudgetGuard {
  controller: TokenBudgetController;
  policy?: RunBudgetPolicy;
  ledger: EventLedger;
}

export async function assertMetaCriticRunBudget(guard: MetaCriticRunBudgetGuard, runId: string): Promise<void> {
  const result = checkRunBudget(guard.controller, runId, guard.policy);
  if (result.allowed) return;
  const reason = result.reason ?? 'budget denied';
  await abortRunForBudget(guard.ledger, runId, reason);
  throw new Error(reason);
}
