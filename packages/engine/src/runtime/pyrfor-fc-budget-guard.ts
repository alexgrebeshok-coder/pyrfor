/**
 * pyrfor-fc-budget-guard.ts
 *
 * Wraps runFreeClaude with pre-flight and periodic token-budget checks.
 * Pre-flight denied → return synthetic error envelope, FC never spawned.
 * Mid-run periodic check denied → abort FC, return error envelope.
 * On completion → record actual consumption via controller.recordConsumption.
 */

import { runFreeClaude } from './pyrfor-fc-adapter';
import type { FCRunOptions, FCHandle, FCEnvelope } from './pyrfor-fc-adapter';
import type {
  TokenBudgetController,
  BudgetScope,
  Consumption,
} from './token-budget-controller';
import { envelopeToSessionCost } from './pyrfor-cost-aggregate';

export interface FcBudgetGuardOptions {
  controller: TokenBudgetController;
  scope: BudgetScope;
  scopeId?: string;
  /** Pre-flight token estimate. Default: 8192 prompt + 4096 completion. */
  preflightEstimate?: { promptTokens: number; completionTokens: number };
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

function syntheticError(error: string): FCEnvelope {
  return {
    status: 'error',
    error,
    exitCode: -1,
    filesTouched: [],
    commandsRun: [],
    raw: {},
  };
}

/**
 * Spawn FC under budget supervision.
 *
 * 1. Pre-check canConsume with preflight estimate. Denied → return error envelope.
 * 2. Spawn FC; periodically re-check canConsume. Denied → abort + return error envelope.
 * 3. Final canConsume check with actual tokens (provides the "pre + final" count when periodic=0).
 * 4. Record actual consumption via recordConsumption.
 */
export async function runFreeClaudeWithBudget(
  opts: FCRunOptions,
  guard: FcBudgetGuardOptions,
): Promise<FCEnvelope> {
  const {
    controller,
    scope,
    scopeId: targetId,
    preflightEstimate = { promptTokens: 8192, completionTokens: 4096 },
    checkIntervalMs = 10_000,
    runFn = runFreeClaude,
    now = () => Date.now(),
    logger,
    onBudgetAbort,
  } = guard;

  // ── Pre-flight ─────────────────────────────────────────────────────────────
  const preCheck = controller.canConsume({
    scope,
    targetId,
    estPromptTokens: preflightEstimate.promptTokens,
    estCompletionTokens: preflightEstimate.completionTokens,
    estCostUsd: 0,
  });

  if (!preCheck.allowed) {
    const reason = `budget denied: ${preCheck.blockingRule ?? 'limit exceeded'}`;
    logger?.('warn', `FC budget pre-check denied: ${reason}`, { scope, targetId });
    return syntheticError(reason);
  }

  logger?.('info', 'FC budget pre-check passed, spawning FC', { scope, targetId });

  // ── Spawn ──────────────────────────────────────────────────────────────────
  const handle = runFn(opts);
  let abortReason: string | null = null;

  // ── Periodic checks ────────────────────────────────────────────────────────
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  if (checkIntervalMs > 0) {
    intervalHandle = setInterval(() => {
      if (abortReason) return;
      const midCheck = controller.canConsume({
        scope,
        targetId,
        estPromptTokens: 0,
        estCompletionTokens: 0,
        estCostUsd: 0,
      });
      if (!midCheck.allowed) {
        abortReason = `budget exhausted: ${midCheck.blockingRule ?? 'limit exceeded'}`;
        logger?.('warn', 'FC budget mid-run check denied, aborting', { reason: abortReason });
        onBudgetAbort?.(abortReason);
        handle.abort('budget exhausted');
        if (intervalHandle !== null) {
          clearInterval(intervalHandle);
          intervalHandle = null;
        }
      }
    }, checkIntervalMs);
  }

  let runResult;
  try {
    runResult = await handle.complete();
  } finally {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  // ── Mid-run abort result ───────────────────────────────────────────────────
  if (abortReason) {
    return syntheticError(abortReason);
  }

  const envelope = runResult.envelope;

  // ── Final canConsume check with actual tokens (counts as "final" in pre+final) ──
  const sessionCost = envelopeToSessionCost(envelope, now);
  controller.canConsume({
    scope,
    targetId,
    estPromptTokens: sessionCost.promptTokens,
    estCompletionTokens: sessionCost.completionTokens,
    estCostUsd: sessionCost.costUsd,
  });

  // ── Record actual consumption ──────────────────────────────────────────────
  const consumption: Consumption = {
    ts: now(),
    scope,
    targetId,
    promptTokens: sessionCost.promptTokens,
    completionTokens: sessionCost.completionTokens,
    costUsd: sessionCost.costUsd,
  };
  controller.recordConsumption(consumption);

  logger?.('info', 'FC run completed, consumption recorded', {
    scope,
    targetId,
    promptTokens: sessionCost.promptTokens,
    completionTokens: sessionCost.completionTokens,
  });

  return envelope;
}
