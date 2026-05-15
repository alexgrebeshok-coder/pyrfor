import { createHash, randomUUID } from 'node:crypto';
export function distillLessons(input) {
    const evidence = input.lessons.evidenceRefs.map((artifactRef) => ({
        artifactRef,
        verifierConfirmed: input.lessons.confidence !== 'low',
    }));
    const singleLoop = makeSingleLoop(input, evidence);
    const doubleLoop = shouldCreateDoubleLoop(input.lessons)
        ? makeDoubleLoop(input, evidence)
        : undefined;
    return { singleLoop, doubleLoop };
}
function makeSingleLoop(input, evidence) {
    var _a, _b;
    return {
        id: randomUUID(),
        kind: 'single_loop',
        provenance: input.context.nodeKind === 'legacy' ? 'legacy' : 'native',
        confidence: input.lessons.confidence,
        context: input.context,
        sourceLessonsArtifactRef: input.sourceLessonsArtifactRef,
        sourceRunId: input.context.runId,
        artifactIds: uniqueStrings([input.sourceLessonsArtifactRef, ...input.lessons.evidenceRefs]),
        approvalState: 'approved',
        legacy: input.context.nodeKind === 'legacy',
        quarantined: false,
        evidence,
        createdAt: new Date().toISOString(),
        author: 'historian',
        originDecisionRecordRef: (_a = input.originDecisionRecord) === null || _a === void 0 ? void 0 : _a.id,
        supportingDecisionRecordRefs: (_b = input.supportingDecisionRecords) === null || _b === void 0 ? void 0 : _b.map((record) => record.id),
        defectRootCause: input.lessons.rootCause,
        defectSignature: hashText([...input.lessons.whatFailed, input.lessons.rootCause].join('\n')),
        fixApplied: input.lessons.whatWorked.join('\n') || 'no reusable fix recorded',
        fixType: classifyFixType(input.lessons),
        algorithmOutcome: normalizeAlgorithmOutcome(input.lessons.algorithmOutcome),
        localOnly: input.lessons.confidence !== 'high',
        eligibleForStrategyDistillation: input.lessons.confidence === 'high' && input.context.nodeKind !== 'legacy',
    };
}
function makeDoubleLoop(input, evidence) {
    var _a, _b, _c, _d, _e, _f, _g;
    const proposedRule = (_c = (_b = (_a = input.lessons.policyProposal) !== null && _a !== void 0 ? _a : input.lessons.strategyDelta) !== null && _b !== void 0 ? _b : input.lessons.toolDelta) !== null && _c !== void 0 ? _c : 'unspecified rule delta';
    return {
        id: randomUUID(),
        kind: 'double_loop',
        provenance: input.context.nodeKind === 'legacy' ? 'legacy' : 'native',
        confidence: input.lessons.confidence,
        context: input.context,
        sourceLessonsArtifactRef: input.sourceLessonsArtifactRef,
        sourceRunId: input.context.runId,
        artifactIds: uniqueStrings([input.sourceLessonsArtifactRef, ...input.lessons.evidenceRefs]),
        approvalState: input.context.nodeKind === 'legacy' ? 'quarantined' : 'pending_approval',
        legacy: input.context.nodeKind === 'legacy',
        quarantined: input.context.nodeKind === 'legacy',
        evidence,
        createdAt: new Date().toISOString(),
        author: 'historian',
        originDecisionRecordRef: (_d = input.originDecisionRecord) === null || _d === void 0 ? void 0 : _d.id,
        supportingDecisionRecordRefs: (_e = input.supportingDecisionRecords) === null || _e === void 0 ? void 0 : _e.map((record) => record.id),
        proposedChangeType: classifyProposedChangeType(input.lessons),
        targetScope: {
            algorithm: input.context.algorithm,
            phase: input.context.phase,
            nodeKind: input.context.nodeKind,
            ruleKey: `${input.context.algorithm}.${input.context.phase}.${input.lessons.rootCause}`,
            currentRule: 'current governance rule',
            proposedRule,
        },
        systemicDefect: input.lessons.whatFailed.join('\n') || input.lessons.rootCause,
        expectedImpact: (_g = (_f = input.lessons.strategyDelta) !== null && _f !== void 0 ? _f : input.lessons.policyProposal) !== null && _g !== void 0 ? _g : 'reduce repeated failure class',
        impact: {
            predictedScore: input.lessons.confidence === 'high' ? 0.8 : 0.5,
        },
        risks: ['requires verifier confirmation before activation'],
        rollbackPlan: 'revert governance_adjustment_proposal and restore previous rule snapshot',
        status: input.context.nodeKind === 'legacy' ? 'quarantined' : 'candidate',
        similarityKey: hashText(`${input.context.algorithm}:${input.context.phase}:${proposedRule}`),
        requiresNovelEvidenceAfterRejection: true,
    };
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function shouldCreateDoubleLoop(lessons) {
    return Boolean(lessons.policyProposal || lessons.strategyDelta || lessons.scope === 'policy' || lessons.scope === 'strategy');
}
function classifyProposedChangeType(lessons) {
    if (lessons.scope === 'policy' || lessons.policyProposal)
        return 'policy';
    if (lessons.rootCause === 'budget_or_tier')
        return 'budget';
    if (lessons.rootCause === 'verifier_disagreement')
        return 'verifier_rules';
    if (lessons.strategyDelta)
        return 'heuristic';
    return 'algorithm';
}
function classifyFixType(lessons) {
    if (lessons.toolDelta)
        return 'tool_swap';
    if (lessons.rootCause === 'test_gap')
        return 'test_rewrite';
    if (lessons.rootCause === 'spec_gap')
        return 'spec_clarification';
    if (lessons.rootCause === 'tool_gap')
        return 'tool_retry';
    return 'replan';
}
function normalizeAlgorithmOutcome(value) {
    if (value === 'improved' || value === 'neutral' || value === 'worsened')
        return value;
    if (value === 'success')
        return 'improved';
    if (value === 'failed_to_meet_criteria')
        return 'worsened';
    return 'neutral';
}
function hashText(value) {
    return createHash('sha256').update(value).digest('hex');
}
