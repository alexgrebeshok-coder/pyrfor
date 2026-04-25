/**
 * pyrfor-fc-budget-guard.ts
 *
 * Wraps runFreeClaude with pre-flight and periodic token-budget checks.
 * Pre-flight denied → return synthetic error envelope, FC never spawned.
 * Mid-run periodic check denied → abort FC, return error envelope.
 * On completion → record actual consumption via controller.recordConsumption.
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
import { runFreeClaude } from './pyrfor-fc-adapter.js';
import { envelopeToSessionCost } from './pyrfor-cost-aggregate.js';
function syntheticError(error) {
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
export function runFreeClaudeWithBudget(opts, guard) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { controller, scope, scopeId: targetId, preflightEstimate = { promptTokens: 8192, completionTokens: 4096 }, checkIntervalMs = 10000, runFn = runFreeClaude, now = () => Date.now(), logger, onBudgetAbort, } = guard;
        // ── Pre-flight ─────────────────────────────────────────────────────────────
        const preCheck = controller.canConsume({
            scope,
            targetId,
            estPromptTokens: preflightEstimate.promptTokens,
            estCompletionTokens: preflightEstimate.completionTokens,
            estCostUsd: 0,
        });
        if (!preCheck.allowed) {
            const reason = `budget denied: ${(_a = preCheck.blockingRule) !== null && _a !== void 0 ? _a : 'limit exceeded'}`;
            logger === null || logger === void 0 ? void 0 : logger('warn', `FC budget pre-check denied: ${reason}`, { scope, targetId });
            return syntheticError(reason);
        }
        logger === null || logger === void 0 ? void 0 : logger('info', 'FC budget pre-check passed, spawning FC', { scope, targetId });
        // ── Spawn ──────────────────────────────────────────────────────────────────
        const handle = runFn(opts);
        let abortReason = null;
        // ── Periodic checks ────────────────────────────────────────────────────────
        let intervalHandle = null;
        if (checkIntervalMs > 0) {
            intervalHandle = setInterval(() => {
                var _a;
                if (abortReason)
                    return;
                const midCheck = controller.canConsume({
                    scope,
                    targetId,
                    estPromptTokens: 0,
                    estCompletionTokens: 0,
                    estCostUsd: 0,
                });
                if (!midCheck.allowed) {
                    abortReason = `budget exhausted: ${(_a = midCheck.blockingRule) !== null && _a !== void 0 ? _a : 'limit exceeded'}`;
                    logger === null || logger === void 0 ? void 0 : logger('warn', 'FC budget mid-run check denied, aborting', { reason: abortReason });
                    onBudgetAbort === null || onBudgetAbort === void 0 ? void 0 : onBudgetAbort(abortReason);
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
            runResult = yield handle.complete();
        }
        finally {
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
        const consumption = {
            ts: now(),
            scope,
            targetId,
            promptTokens: sessionCost.promptTokens,
            completionTokens: sessionCost.completionTokens,
            costUsd: sessionCost.costUsd,
        };
        controller.recordConsumption(consumption);
        logger === null || logger === void 0 ? void 0 : logger('info', 'FC run completed, consumption recorded', {
            scope,
            targetId,
            promptTokens: sessionCost.promptTokens,
            completionTokens: sessionCost.completionTokens,
        });
        return envelope;
    });
}
