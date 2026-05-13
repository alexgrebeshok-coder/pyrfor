import { createHash } from 'node:crypto';
import type { DagNode, DagProvenanceLink } from '../durable-dag';
import type { LedgerAppendInput } from '../event-ledger';
import { isNeverGrandfatheredGate } from './tier-decider';

export type GovernedAlgorithm =
  | 'strategic_planning'
  | 'research_tool_creation'
  | 'execution_quality_control'
  | 'lessons_learned'
  | 'system_self_improvement';

export type GateDisposition =
  | 'passed'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'waived_by_approval';

export type GateKind = 'admission' | 'completion';

export type GateTrigger =
  | 'completion_requested'
  | 'artifact_created'
  | 'approval_granted'
  | 'approval_denied'
  | 'manual_retry'
  | 'ledger_replay';

export type GateViolationCode =
  | 'missing_artifact'
  | 'artifact_invalid'
  | 'criteria_unsatisfied'
  | 'out_of_sequence'
  | 'approval_required'
  | 'tool_cap_exhausted'
  | 'decision_record_invalid';

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

export function createCompletionGateEngine(): CompletionGateEngine {
  return {
    beforeNodeComplete(input) {
      return evaluateCompletionGate(input);
    },
  };
}

export function evaluateCompletionGate(input: CompletionGateInput): CompletionGateResult {
  const gateId = input.gateId ?? gateIdForNode(input.node);
  const requiredArtifacts = input.requiredArtifacts ?? requirementsForNode(input.node);
  const allProvenance = [...input.node.provenance, ...input.provenance];
  const snapshot = buildGateEvidenceSnapshot({
    contractHash: input.contractHash ?? hashStable({
      gateId,
      nodeKind: input.node.kind,
      requiredArtifacts,
      successCriteria: input.successCriteria ?? [],
    }),
    provenance: allProvenance,
    approvalRefs: input.approvalRefs ?? [],
    ledgerHighWatermarkSeq: input.ledgerHighWatermarkSeq ?? 0,
  });

  const missing = missingArtifactKinds(requiredArtifacts, allProvenance);
  if (input.node.payload['algorithmCoverage'] === 'grandfathered' && isNeverGrandfatheredGate(gateId)) {
    const checkEvent: LedgerAppendInput = {
      type: 'governance.gate.checked',
      run_id: input.runId,
      dag_id: input.dagId,
      node_id: input.node.id,
      governed_algorithm: input.governedAlgorithm,
      gate_id: gateId,
      gate_kind: input.gateKind ?? 'completion',
      gate_revision: input.gateRevision ?? 1,
      trigger: input.trigger ?? 'completion_requested',
      attempt: input.node.attempts,
      required_artifacts: requiredArtifacts,
      present_artifact_refs: snapshot.artifactRefs,
      missing_artifact_kinds: missing,
      success_criteria: input.successCriteria ?? [],
      decision_vector_ref: input.decisionVectorRef,
      approval_state: input.approvalState ?? 'none',
      disposition: 'failed_terminal',
      retryable: false,
      evidence_snapshot_hash: snapshot.evidenceSnapshotHash,
      contract_hash: snapshot.contractHash,
    };
    const violationEvent: LedgerAppendInput = {
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

  if (
    input.previousEvidenceSnapshotHash !== undefined &&
    input.previousEvidenceSnapshotHash === snapshot.evidenceSnapshotHash
  ) {
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

  const gateDisposition: GateDisposition = missing.length === 0 ? 'passed' : 'failed_retryable';
  const checkEvent: LedgerAppendInput = {
    type: 'governance.gate.checked',
    run_id: input.runId,
    dag_id: input.dagId,
    node_id: input.node.id,
    governed_algorithm: input.governedAlgorithm,
    gate_id: gateId,
    gate_kind: input.gateKind ?? 'completion',
    gate_revision: input.gateRevision ?? 1,
    trigger: input.trigger ?? 'completion_requested',
    attempt: input.node.attempts,
    required_artifacts: requiredArtifacts,
    present_artifact_refs: snapshot.artifactRefs,
    missing_artifact_kinds: missing,
    success_criteria: input.successCriteria ?? [],
    decision_vector_ref: input.decisionVectorRef,
    approval_state: input.approvalState ?? 'none',
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

  const violationEvent: LedgerAppendInput = {
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

export function buildGateEvidenceSnapshot(input: {
  contractHash: string;
  provenance: DagProvenanceLink[];
  approvalRefs: string[];
  ledgerHighWatermarkSeq: number;
}): GateEvidenceSnapshot {
  const artifactRefs = input.provenance
    .filter((link) => link.kind === 'artifact')
    .map((link) => link.ref)
    .sort();
  const artifactKinds = input.provenance
    .filter((link) => link.kind === 'artifact')
    .map((link) => artifactKindFromLink(link))
    .filter((kind): kind is string => kind !== undefined)
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

export function requirementsForNode(node: DagNode): GateArtifactRequirement[] {
  const fromPayload = node.payload['requiredArtifacts'];
  if (Array.isArray(fromPayload)) {
    return fromPayload
      .filter((item): item is string => typeof item === 'string')
      .map((kind) => ({ kind }));
  }
  const completionGate = node.payload['completionGate'];
  if (isRecord(completionGate) && Array.isArray(completionGate['requiredArtifacts'])) {
    return completionGate['requiredArtifacts']
      .filter((item): item is string => typeof item === 'string')
      .map((kind) => ({ kind }));
  }
  return [];
}

export function gateIdForNode(node: DagNode): string {
  const configured = node.payload['gateId'];
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return `${node.kind}.completion.v1`;
}

function missingArtifactKinds(
  requirements: GateArtifactRequirement[],
  provenance: DagProvenanceLink[],
): string[] {
  const present = new Map<string, number>();
  for (const link of provenance) {
    if (link.kind !== 'artifact') continue;
    const artifactKind = artifactKindFromLink(link);
    if (!artifactKind) continue;
    present.set(artifactKind, (present.get(artifactKind) ?? 0) + 1);
  }
  return requirements
    .filter((requirement) => (present.get(requirement.kind) ?? 0) < normalizedMinCount(requirement.minCount))
    .map((requirement) => requirement.kind);
}

function normalizedMinCount(minCount: number | undefined): number {
  if (minCount === undefined) return 1;
  if (!Number.isFinite(minCount) || minCount < 1) return 1;
  return Math.floor(minCount);
}

function artifactKindFromLink(link: DagProvenanceLink): string | undefined {
  const metaKind = link.meta?.['artifactKind'];
  return typeof metaKind === 'string' ? metaKind : undefined;
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
