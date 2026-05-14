import type { DagNode, DagProvenanceLink } from '../durable-dag';
import type { LedgerAppendInput } from '../event-ledger';
export type GovernedAlgorithm = 'strategic_planning' | 'research_tool_creation' | 'execution_quality_control' | 'lessons_learned' | 'system_self_improvement';
export type GateDisposition = 'passed' | 'failed_retryable' | 'failed_terminal' | 'waived_by_approval';
export type GateKind = 'admission' | 'completion';
export type GateTrigger = 'completion_requested' | 'artifact_created' | 'approval_granted' | 'approval_denied' | 'manual_retry' | 'ledger_replay';
export type GateViolationCode = 'missing_artifact' | 'artifact_invalid' | 'criteria_unsatisfied' | 'out_of_sequence' | 'approval_required' | 'tool_cap_exhausted' | 'decision_record_invalid';
export interface GateArtifactRequirement {
    kind: string;
    minCount?: number;
    mustBeSigned?: boolean;
    mustBeFromVerifierFamily?: string[];
    waivable?: boolean;
}
export interface GateEvidenceSnapshot {
    artifactRefs: string[];
    approvalRefs: string[];
    artifactKinds: string[];
    contractHash: string;
    evidenceSnapshotHash: string;
    ledgerHighWatermarkSeq: number;
}
export interface CompletionGateInput {
    runId: string;
    dagId?: string;
    node: DagNode;
    provenance: DagProvenanceLink[];
    governedAlgorithm?: GovernedAlgorithm;
    gateId?: string;
    gateKind?: GateKind;
    gateRevision?: number;
    trigger?: GateTrigger;
    requiredArtifacts?: GateArtifactRequirement[];
    successCriteria?: string[];
    contractHash?: string;
    approvalRefs?: string[];
    decisionVectorRef?: string;
    approvalState?: 'none' | 'pending' | 'granted' | 'denied';
    ledgerHighWatermarkSeq?: number;
    previousEvidenceSnapshotHash?: string;
}
export interface CompletionGateResult {
    disposition: 'allow_complete' | 'await_new_evidence' | 'escalate_approval' | 'block_terminal';
    gateDisposition: GateDisposition;
    gateId: string;
    missingArtifactKinds: string[];
    evidenceSnapshot: GateEvidenceSnapshot;
    events: LedgerAppendInput[];
    reason?: string;
}
export interface CompletionGateEngine {
    beforeNodeComplete(input: CompletionGateInput): CompletionGateResult;
}
export declare function createCompletionGateEngine(): CompletionGateEngine;
export declare function evaluateCompletionGate(input: CompletionGateInput): CompletionGateResult;
export declare function buildGateEvidenceSnapshot(input: {
    contractHash: string;
    provenance: DagProvenanceLink[];
    approvalRefs: string[];
    ledgerHighWatermarkSeq: number;
}): GateEvidenceSnapshot;
export declare function requirementsForNode(node: DagNode): GateArtifactRequirement[];
export declare function gateIdForNode(node: DagNode): string;
//# sourceMappingURL=completion-gate-engine.d.ts.map