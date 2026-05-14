import { createHash } from 'node:crypto';
export const NEVER_GRANDFATHERED_GATES = [
    'unsafe_intent_block',
    'declared_effects_enforcement',
    'sandbox_tier_assignment',
    'taint_scan',
    'prompt_injection_scan',
    'approval_for_policy_change',
    'approval_for_budget_change',
    'kill_switch',
];
export function createDefaultGrandfatheringScope(bypasses) {
    return {
        bypasses,
        neverBypassed: NEVER_GRANDFATHERED_GATES,
        blocksDoubleLoopParticipation: true,
        blocksSystemSelfImprovementParticipation: true,
        emittedLessonProvenance: 'legacy',
        allowsGovernanceProposalEmission: false,
    };
}
export function materializeLegacyBaselineManifest(input) {
    assertGitCommitSha(input.baselineCommit, 'baselineCommit');
    assertGitCommitSha(input.resolvedBaselineCommit, 'resolvedBaselineCommit');
    if (input.resolvedBaselineCommit !== input.baselineCommit) {
        throw new Error(`baseline tag ${input.baselineTag} resolves to ${input.resolvedBaselineCommit}, expected ${input.baselineCommit}`);
    }
    return {
        baselineTag: input.baselineTag,
        baselineCommit: input.baselineCommit,
        baselineManifestArtifactRef: input.baselineManifestArtifactRef,
        nodeHashes: [...new Set(input.nodes.map((node) => nodeHashForAudit(node)))].sort(),
    };
}
function assertGitCommitSha(value, field) {
    if (!/^[0-9a-f]{40}$/i.test(value)) {
        throw new Error(`${field} must be a full 40-character git commit SHA`);
    }
}
export function assertLegacyEligibility(input) {
    const nodeHash = nodeHashForAudit(input.node);
    if (!input.baselineManifest.nodeHashes.includes(nodeHash)) {
        throw new Error(`legacy node hash is outside baseline manifest: ${nodeHash}`);
    }
    return {
        nodeHash,
        baselineTag: input.baselineManifest.baselineTag,
        baselineCommit: input.baselineManifest.baselineCommit,
        baselineManifestArtifactRef: input.baselineManifest.baselineManifestArtifactRef,
        firstSeenEventId: input.firstSeenEventId,
        firstSeenAt: input.firstSeenAt,
    };
}
export function generateLegacyNodeAuditReport(input) {
    var _a, _b, _c, _d, _e, _f;
    const generatedAt = (_a = input.generatedAt) !== null && _a !== void 0 ? _a : new Date().toISOString();
    const grandfathered = input.nodes.filter((node) => node.payload['algorithmCoverage'] === 'grandfathered');
    const byPhase = {};
    const byBypassedGate = Object.create(null);
    const neverGrandfatheredViolations = [];
    const highRiskNodes = [];
    const migrationCandidates = [];
    let legacyLessonsEmitted = 0;
    let governanceProposalsSuppressed = 0;
    for (const node of grandfathered) {
        const nodeHash = nodeHashForAudit(node);
        const phase = (_c = (_b = stringPayload(node, 'phase')) !== null && _b !== void 0 ? _b : stringPayload(node, 'engine_phase')) !== null && _c !== void 0 ? _c : 'unknown';
        byPhase[phase] = ((_d = byPhase[phase]) !== null && _d !== void 0 ? _d : 0) + 1;
        const bypasses = grandfatheringBypasses(node);
        for (const gate of bypasses)
            byBypassedGate[gate] = ((_e = byBypassedGate[gate]) !== null && _e !== void 0 ? _e : 0) + 1;
        const firstSeenAt = new Date(node.createdAt).toISOString();
        try {
            assertLegacyEligibility({
                node,
                baselineManifest: input.baselineManifest,
                firstSeenEventId: (_f = stringPayload(node, 'firstSeenEventId')) !== null && _f !== void 0 ? _f : '',
                firstSeenAt,
            });
        }
        catch (_g) {
            neverGrandfatheredViolations.push({
                nodeId: node.id,
                nodeHash,
                gate: 'unsafe_intent_block',
                eventRef: stringPayload(node, 'firstSeenEventId'),
            });
        }
        if (numberPayload(node, 'sideEffectCount') > 0 || bypasses.length > 2) {
            highRiskNodes.push({
                nodeId: node.id,
                nodeHash,
                phase,
                bypasses,
                sideEffectCount: numberPayload(node, 'sideEffectCount'),
                lastSeenAt: new Date(node.updatedAt).toISOString(),
            });
        }
        if (node.payload['lessonProvenance'] === 'legacy')
            legacyLessonsEmitted += 1;
        if (node.payload['suppressedGovernanceProposal'] === true)
            governanceProposalsSuppressed += 1;
        migrationCandidates.push({
            nodeId: node.id,
            nodeHash,
            recommendedActions: [
                'declare governedByAlgorithm',
                'attach completionGate',
                'attach feedbackContract',
                'create canonical DecisionRecord',
            ],
            priority: bypasses.length > 2 ? 'high' : 'medium',
        });
    }
    return {
        id: createHash('sha256')
            .update(`${input.baselineManifest.baselineTag}:${input.periodStart}:${input.periodEnd}:${grandfathered.length}`)
            .digest('hex')
            .slice(0, 24),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        baselineTag: input.baselineManifest.baselineTag,
        generatedAt,
        totalGrandfatheredNodes: grandfathered.length,
        activeGrandfatheredNodes: grandfathered.filter((node) => node.status !== 'succeeded' && node.status !== 'cancelled').length,
        byPhase,
        byBypassedGate,
        neverGrandfatheredViolations,
        highRiskNodes,
        legacyLessonsEmitted,
        governanceProposalsSuppressed,
        migrationCandidates,
    };
}
function grandfatheringBypasses(node) {
    const raw = node.payload['grandfatheringScope'];
    if (!isRecord(raw) || !Array.isArray(raw['bypasses']))
        return [];
    return raw['bypasses'].filter((item) => typeof item === 'string' && isGrandfatherableGate(item));
}
function isGrandfatherableGate(value) {
    return [
        'algorithm_declared',
        'decision_record_required',
        'completion_gate_presence',
        'feedback_contract_presence',
        'phase_algorithm_mapping_inferred',
        'lesson_sink_required',
    ].includes(value);
}
function nodeHashForAudit(node) {
    const configured = stringPayload(node, 'nodeHash');
    if (configured)
        return configured;
    return createHash('sha256').update(JSON.stringify({
        id: node.id,
        kind: node.kind,
        idempotencyKey: node.idempotencyKey,
    })).digest('hex');
}
function stringPayload(node, key) {
    const value = node.payload[key];
    return typeof value === 'string' ? value : undefined;
}
function numberPayload(node, key) {
    const value = node.payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
