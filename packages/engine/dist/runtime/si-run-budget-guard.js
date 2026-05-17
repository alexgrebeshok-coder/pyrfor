/**
 * Run-level budget guard for self-improvement (MetaCritic) runs.
 *
 * Reuses TokenBudgetController pre-check patterns from pyrfor-fc-budget-guard.
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
export function checkRunBudget(controller, runId, policy = {}) {
    var _a, _b, _c, _d;
    const scope = (_a = policy.scope) !== null && _a !== void 0 ? _a : 'task';
    const preflight = (_b = policy.preflightEstimate) !== null && _b !== void 0 ? _b : { promptTokens: 4096, completionTokens: 2048, costUsd: 0.01 };
    const check = controller.canConsume({
        scope,
        targetId: runId,
        estPromptTokens: preflight.promptTokens,
        estCompletionTokens: preflight.completionTokens,
        estCostUsd: (_c = preflight.costUsd) !== null && _c !== void 0 ? _c : 0,
    });
    if (!check.allowed) {
        return {
            allowed: false,
            reason: `budget denied: ${(_d = check.blockingRule) !== null && _d !== void 0 ? _d : 'limit exceeded'}`,
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
export function abortRunForBudget(ledger, runId, reason) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ledger.append({
            type: 'run.blocked',
            run_id: runId,
            reason,
        });
    });
}
export function assertMetaCriticRunBudget(guard, runId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const result = checkRunBudget(guard.controller, runId, guard.policy);
        if (result.allowed)
            return;
        const reason = (_a = result.reason) !== null && _a !== void 0 ? _a : 'budget denied';
        yield abortRunForBudget(guard.ledger, runId, reason);
        throw new Error(reason);
    });
}
