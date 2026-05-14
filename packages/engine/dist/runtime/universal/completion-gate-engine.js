import { createHash } from 'node:crypto';
import { isNeverGrandfatheredGate } from './tier-decider.js';
export function createCompletionGateEngine() {
    return {
        beforeNodeComplete(input) {
            return evaluateCompletionGate(input);
        },
    };
}
export function evaluateCompletionGate(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    const gateId = (_a = input.gateId) !== null && _a !== void 0 ? _a : gateIdForNode(input.node);
    const requiredArtifacts = (_b = input.requiredArtifacts) !== null && _b !== void 0 ? _b : requirementsForNode(input.node);
    const allProvenance = [...input.node.provenance, ...input.provenance];
    const snapshot = buildGateEvidenceSnapshot({
        contractHash: (_c = input.contractHash) !== null && _c !== void 0 ? _c : hashStable({
            gateId,
            nodeKind: input.node.kind,
            requiredArtifacts,
            successCriteria: (_d = input.successCriteria) !== null && _d !== void 0 ? _d : [],
        }),
        provenance: allProvenance,
        approvalRefs: (_e = input.approvalRefs) !== null && _e !== void 0 ? _e : [],
        ledgerHighWatermarkSeq: (_f = input.ledgerHighWatermarkSeq) !== null && _f !== void 0 ? _f : 0,
    });
    const missing = missingArtifactKinds(requiredArtifacts, allProvenance);
    if (input.node.payload['algorithmCoverage'] === 'grandfathered' && isNeverGrandfatheredGate(gateId)) {
        const checkEvent = {
            type: 'governance.gate.checked',
            run_id: input.runId,
            dag_id: input.dagId,
            node_id: input.node.id,
            governed_algorithm: input.governedAlgorithm,
            gate_id: gateId,
            gate_kind: (_g = input.gateKind) !== null && _g !== void 0 ? _g : 'completion',
            gate_revision: (_h = input.gateRevision) !== null && _h !== void 0 ? _h : 1,
            trigger: (_j = input.trigger) !== null && _j !== void 0 ? _j : 'completion_requested',
            attempt: input.node.attempts,
            required_artifacts: requiredArtifacts,
            present_artifact_refs: snapshot.artifactRefs,
            missing_artifact_kinds: missing,
            success_criteria: (_k = input.successCriteria) !== null && _k !== void 0 ? _k : [],
            decision_vector_ref: input.decisionVectorRef,
            approval_state: (_l = input.approvalState) !== null && _l !== void 0 ? _l : 'none',
            disposition: 'failed_terminal',
            retryable: false,
            evidence_snapshot_hash: snapshot.evidenceSnapshotHash,
            contract_hash: snapshot.contractHash,
        };
        const violationEvent = {
            type: 'governance.gate.violation',
            run_id: input.runId,
            dag_id: input.dagId,
            node_id: input.node.id,
            gate_id: gateId,
            attempt: input.node.attempts,
            violation_code: 'never_grandfathered_gate',
            reason: `grandfathered legacy node cannot bypass gate: ${gateId}`,
            retryable: false,
            requires_new_evidence: false,
            reopen_on_approval: false,
            blocked_completion: true,
            evidence_snapshot_hash: snapshot.evidenceSnapshotHash,
            contract_hash: snapshot.contractHash,
        };
        return {
            disposition: 'block_terminal',
            gateDisposition: 'failed_terminal',
            gateId,
            missingArtifactKinds: missing,
            evidenceSnapshot: snapshot,
            events: [checkEvent, violationEvent],
            reason: violationEvent.reason,
        };
    }
    if (input.previousEvidenceSnapshotHash !== undefined &&
        input.previousEvidenceSnapshotHash === snapshot.evidenceSnapshotHash) {
        return {
            disposition: 'await_new_evidence',
            gateDisposition: 'failed_retryable',
            gateId,
            missingArtifactKinds: [],
            evidenceSnapshot: snapshot,
            events: [],
            reason: 'duplicate_gate_evaluation_snapshot',
        };
    }
    const gateDisposition = missing.length === 0 ? 'passed' : 'failed_retryable';
    const checkEvent = {
        type: 'governance.gate.checked',
        run_id: input.runId,
        dag_id: input.dagId,
        node_id: input.node.id,
        governed_algorithm: input.governedAlgorithm,
        gate_id: gateId,
        gate_kind: (_m = input.gateKind) !== null && _m !== void 0 ? _m : 'completion',
        gate_revision: (_o = input.gateRevision) !== null && _o !== void 0 ? _o : 1,
        trigger: (_p = input.trigger) !== null && _p !== void 0 ? _p : 'completion_requested',
        attempt: input.node.attempts,
        required_artifacts: requiredArtifacts,
        present_artifact_refs: snapshot.artifactRefs,
        missing_artifact_kinds: missing,
        success_criteria: (_q = input.successCriteria) !== null && _q !== void 0 ? _q : [],
        decision_vector_ref: input.decisionVectorRef,
        approval_state: (_r = input.approvalState) !== null && _r !== void 0 ? _r : 'none',
        disposition: gateDisposition,
        retryable: gateDisposition === 'failed_retryable',
        evidence_snapshot_hash: snapshot.evidenceSnapshotHash,
        contract_hash: snapshot.contractHash,
    };
    if (gateDisposition === 'passed') {
        return {
            disposition: 'allow_complete',
            gateDisposition,
            gateId,
            missingArtifactKinds: [],
            evidenceSnapshot: snapshot,
            events: [checkEvent],
        };
    }
    const violationEvent = {
        type: 'governance.gate.violation',
        run_id: input.runId,
        dag_id: input.dagId,
        node_id: input.node.id,
        gate_id: gateId,
        attempt: input.node.attempts,
        violation_code: 'missing_artifact',
        reason: `missing artifacts: ${missing.join(', ')}`,
        retryable: true,
        requires_new_evidence: true,
        accepted_new_evidence_kinds: missing,
        reopen_on_approval: false,
        blocked_completion: true,
        evidence_snapshot_hash: snapshot.evidenceSnapshotHash,
        contract_hash: snapshot.contractHash,
    };
    return {
        disposition: 'await_new_evidence',
        gateDisposition,
        gateId,
        missingArtifactKinds: missing,
        evidenceSnapshot: snapshot,
        events: [checkEvent, violationEvent],
        reason: violationEvent.reason,
    };
}
export function buildGateEvidenceSnapshot(input) {
    const artifactRefs = input.provenance
        .filter((link) => link.kind === 'artifact')
        .map((link) => link.ref)
        .sort();
    const artifactKinds = input.provenance
        .filter((link) => link.kind === 'artifact')
        .map((link) => artifactKindFromLink(link))
        .filter((kind) => kind !== undefined)
        .sort();
    const approvalRefs = [...input.approvalRefs].sort();
    return {
        artifactRefs,
        approvalRefs,
        artifactKinds,
        contractHash: input.contractHash,
        ledgerHighWatermarkSeq: input.ledgerHighWatermarkSeq,
        evidenceSnapshotHash: hashStable({
            contractHash: input.contractHash,
            artifactRefs,
            approvalRefs,
            ledgerHighWatermarkSeq: input.ledgerHighWatermarkSeq,
        }),
    };
}
export function requirementsForNode(node) {
    const fromPayload = node.payload['requiredArtifacts'];
    if (Array.isArray(fromPayload)) {
        return fromPayload
            .filter((item) => typeof item === 'string')
            .map((kind) => ({ kind }));
    }
    const completionGate = node.payload['completionGate'];
    if (isRecord(completionGate) && Array.isArray(completionGate['requiredArtifacts'])) {
        return completionGate['requiredArtifacts']
            .filter((item) => typeof item === 'string')
            .map((kind) => ({ kind }));
    }
    return [];
}
export function gateIdForNode(node) {
    const configured = node.payload['gateId'];
    if (typeof configured === 'string' && configured.length > 0)
        return configured;
    return `${node.kind}.completion.v1`;
}
function missingArtifactKinds(requirements, provenance) {
    var _a;
    const present = new Map();
    for (const link of provenance) {
        if (link.kind !== 'artifact')
            continue;
        const artifactKind = artifactKindFromLink(link);
        if (!artifactKind)
            continue;
        present.set(artifactKind, ((_a = present.get(artifactKind)) !== null && _a !== void 0 ? _a : 0) + 1);
    }
    return requirements
        .filter((requirement) => { var _a; return ((_a = present.get(requirement.kind)) !== null && _a !== void 0 ? _a : 0) < normalizedMinCount(requirement.minCount); })
        .map((requirement) => requirement.kind);
}
function normalizedMinCount(minCount) {
    if (minCount === undefined)
        return 1;
    if (!Number.isFinite(minCount) || minCount < 1)
        return 1;
    return Math.floor(minCount);
}
function artifactKindFromLink(link) {
    var _a;
    const metaKind = (_a = link.meta) === null || _a === void 0 ? void 0 : _a['artifactKind'];
    return typeof metaKind === 'string' ? metaKind : undefined;
}
function hashStable(value) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
