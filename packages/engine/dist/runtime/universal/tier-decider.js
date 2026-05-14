import { NEVER_GRANDFATHERED_GATES } from './legacy-node-auditor.js';
export function decideTier(input) {
    const vector = input.decisionVector;
    const reasonCodes = [];
    if (isSafetyBlocked(vector)) {
        return result('block', ['safety_block'], true);
    }
    if (vector.gateStatus === 'failed') {
        return result('block', ['gate_failed'], true);
    }
    if (vector.toolCapRemaining <= 0) {
        return result('block', ['tool_cap_exhausted'], true);
    }
    if (isBudgetExhausted(vector)) {
        return result('block', ['budget_exhausted_abort'], true, true);
    }
    if (vector.algorithmCoverage === 'grandfathered' && isNeverGrandfatheredGate(input.gate)) {
        return result('block', ['never_grandfathered_gate', input.gate], true);
    }
    if (isBudgetApprovalRequired(vector))
        reasonCodes.push('budget_approval_required');
    if (vector.reversibility === 'irreversible')
        reasonCodes.push('irreversible_effect');
    if (vector.gateStatus === 'partial')
        reasonCodes.push('partial_gate');
    if (['host', 'container_full', 'restricted'].includes(vector.sandboxTier))
        reasonCodes.push('privileged_sandbox_tier');
    if (['pending_validation', 'sandboxed_experiment'].includes(vector.toolTrustTier))
        reasonCodes.push('low_tool_trust');
    if (vector.estimatedImpact.moneyUsd > 0)
        reasonCodes.push('money_impact');
    if (vector.algorithmCoverage === 'grandfathered')
        reasonCodes.push('legacy_algorithm_coverage');
    if (vector.governedAlgorithm === 'system_self_improvement')
        reasonCodes.push('system_self_improvement');
    if (vector.loopCount > 0 && !vector.newEvidencePresent)
        reasonCodes.push('retry_without_new_evidence');
    if (reasonCodes.length > 0)
        return result('approve', reasonCodes, false);
    if (vector.failureHistoryScore >= 0.5 ||
        vector.algorithmCoverage === 'inferred' ||
        vector.loopCount > 0 ||
        vector.estimatedImpact.fsScope.length > 0 ||
        vector.estimatedImpact.netReach.length > 0) {
        if (vector.failureHistoryScore >= 0.5)
            reasonCodes.push('failure_history_notice');
        if (vector.algorithmCoverage === 'inferred')
            reasonCodes.push('inferred_algorithm_coverage');
        if (vector.loopCount > 0)
            reasonCodes.push('loop_retry_notice');
        if (vector.estimatedImpact.fsScope.length > 0)
            reasonCodes.push('fs_scope_notice');
        if (vector.estimatedImpact.netReach.length > 0)
            reasonCodes.push('network_scope_notice');
        return result('notify', reasonCodes, false);
    }
    return result('autonomous', ['low_risk_autonomous'], false);
}
function result(decision, reasonCodes, abortRequired, requiresApproval = decision === 'approve') {
    return {
        decision,
        reasonCodes,
        requiresApproval,
        abortRequired,
    };
}
function isSafetyBlocked(vector) {
    return vector.sandboxTier === 'forbidden' || vector.toolTrustTier === 'retired';
}
function isBudgetExhausted(vector) {
    return (isTrackedBudgetExhausted(vector.remainingBudget.tokens) ||
        isTrackedBudgetExhausted(vector.remainingBudget.usd) ||
        isTrackedBudgetExhausted(vector.remainingBudget.wallMs));
}
function isBudgetApprovalRequired(vector) {
    return ((vector.remainingBudget.usd !== undefined && vector.estimatedImpact.moneyUsd > vector.remainingBudget.usd) ||
        (vector.remainingBudget.tokens !== undefined && vector.remainingBudget.tokens < 1000) ||
        (vector.remainingBudget.wallMs !== undefined && vector.remainingBudget.wallMs < 10000));
}
function isTrackedBudgetExhausted(value) {
    return value !== undefined && (!Number.isFinite(value) || value <= 0);
}
export function isNeverGrandfatheredGate(value) {
    return typeof value === 'string' && NEVER_GRANDFATHERED_GATES.includes(value);
}
