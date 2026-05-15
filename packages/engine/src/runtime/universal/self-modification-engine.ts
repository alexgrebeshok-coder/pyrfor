import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalRequest } from '../approval-flow';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ImprovementProposal } from './meta-critic';

export interface SelfModificationApprovalFlow {
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface SelfModificationCircuitBreakerOptions {
  maxConsecutiveFailures: number;
}

export interface SelfModificationEngineDeps {
  artifactStore: ArtifactStore;
  approvalFlow: SelfModificationApprovalFlow;
  ledger?: EventLedger;
  circuitBreaker?: SelfModificationCircuitBreakerOptions;
  clock?: () => number;
}

export interface SelfModificationRequest {
  runId: string;
  conceptId: string;
  proposal: ImprovementProposal;
  evalProofRef: ArtifactRef;
  metaMeta?: boolean;
}

export interface SelfModificationResult {
  status:
    | 'proposal_only_pending_approval'
    | 'human_denied'
    | 'quarantined'
    | 'circuit_open';
  reason: string;
  approvalId?: string;
  artifactId?: string;
}

export class SelfModificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfModificationValidationError';
  }
}

export class SelfModificationEngine {
  private consecutiveFailures = 0;

  constructor(private readonly deps: SelfModificationEngineDeps) {
    const maxFailures = this.maxConsecutiveFailures();
    if (!Number.isInteger(maxFailures) || maxFailures < 1) {
      throw new SelfModificationValidationError('maxConsecutiveFailures must be a positive integer');
    }
  }

  async submit(input: SelfModificationRequest): Promise<SelfModificationResult> {
    if (this.consecutiveFailures >= this.maxConsecutiveFailures()) {
      return this.quarantine(input, 'self_modification_circuit_open', 'circuit_open');
    }
    const invalidReason = await this.validate(input);
    if (invalidReason) return this.quarantine(input, invalidReason, 'quarantined');

    const approvalId = randomUUID();
    const decision = await this.deps.approvalFlow.requestApproval({
      id: approvalId,
      toolName: 'self_modification.proposal',
      summary: input.metaMeta
        ? 'Human approval required for meta-meta self-modification proposal'
        : 'Human approval required for self-modification proposal',
      args: {
        entryId: input.proposal.entryId,
        proposalType: input.proposal.record.proposedChangeType,
        ruleKey: input.proposal.record.targetScope.ruleKey,
        evalArtifactId: input.evalProofRef.id,
        rollbackPlan: input.proposal.record.rollbackPlan,
        proposalOnly: true,
      },
      run_id: input.runId,
      concept_id: input.conceptId,
      engine_phase: 'self_improvement',
      reason_codes: ['self_modification_gate', 'human_approval_required', 'proposal_only_no_auto_apply'],
      approval_required: true,
      budget_scope: 'self_improvement',
    });
    const artifactId = await this.writeEnvelope(input, decision === 'approve'
      ? 'proposal_only_pending_approval'
      : 'human_denied', approvalId);
    await this.emit('self_improvement.proposal.escalated', input, {
      approval_id: approvalId,
      artifact_id: artifactId,
      reason: decision === 'approve' ? 'human_approved_proposal_only_no_auto_apply' : `human_${decision}`,
    });
    if (decision === 'approve') {
      this.consecutiveFailures = 0;
      return {
        status: 'proposal_only_pending_approval',
        reason: 'human_approved_proposal_only_no_auto_apply',
        approvalId,
        artifactId,
      };
    }
    this.consecutiveFailures += 1;
    return {
      status: 'human_denied',
      reason: `human_${decision}`,
      approvalId,
      artifactId,
    };
  }

  private async validate(input: SelfModificationRequest): Promise<string | undefined> {
    if (!input.runId.trim()) return 'runId_required';
    if (!input.conceptId.trim()) return 'conceptId_required';
    if (input.proposal.schemaVersion !== 'pyrfor.improvement_proposal.v1') return 'invalid_schema_version';
    if (!input.proposal.record.rollbackPlan.trim()) return 'missing_rollback_plan';
    if (!input.proposal.rollbackVerified) return 'rollback_not_verified';
    if (input.proposal.evalArtifactId !== input.evalProofRef.id) return 'eval_proof_mismatch';
    if (input.evalProofRef.kind !== 'test_result') return 'invalid_eval_proof:not_test_result';
    if (input.evalProofRef.runId !== input.runId) return 'invalid_eval_proof:run_mismatch';
    if (!input.evalProofRef.sha256) return 'invalid_eval_proof:missing_sha256';
    if (!(await this.deps.artifactStore.exists(input.evalProofRef))) return 'invalid_eval_proof:missing_artifact';
    let proof: unknown;
    try {
      proof = await this.deps.artifactStore.readJSONVerified(input.evalProofRef, input.evalProofRef.sha256);
    } catch {
      return 'invalid_eval_proof:unverified_artifact';
    }
    if (!isEvalProofBody(proof)) return 'invalid_eval_proof:invalid_payload';
    if (proof.runId !== input.runId) return 'invalid_eval_proof:payload_run_mismatch';
    if (proof.subjectId !== input.proposal.record.id) return 'invalid_eval_proof:payload_subject_mismatch';
    if (proof.verdict !== 'pass' || proof.status !== 'passed') return 'invalid_eval_proof:payload_verdict_mismatch';
    return undefined;
  }

  private async quarantine(
    input: SelfModificationRequest,
    reason: string,
    status: 'quarantined' | 'circuit_open',
  ): Promise<SelfModificationResult> {
    this.consecutiveFailures += 1;
    const artifactId = await this.writeEnvelope(input, status, undefined, reason);
    await this.emit('self_improvement.proposal.quarantined', input, { artifact_id: artifactId, reason });
    return { status, reason, artifactId };
  }

  private async writeEnvelope(
    input: SelfModificationRequest,
    status: SelfModificationResult['status'],
    approvalId?: string,
    reason?: string,
  ): Promise<string> {
    const ref = await this.deps.artifactStore.writeJSON('improvement_proposal', {
      schemaVersion: 'pyrfor.self_modification_envelope.v1',
      proposal: input.proposal,
      evalProofRef: input.evalProofRef,
      status,
      approvalId,
      reason,
      proposalOnly: true,
      autoApply: false,
      metaMeta: input.metaMeta === true,
      generatedAt: new Date((this.deps.clock ?? Date.now)()).toISOString(),
    }, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        entryId: input.proposal.entryId,
        status,
      },
    });
    return ref.id;
  }

  private async emit(
    type: 'self_improvement.proposal.escalated' | 'self_improvement.proposal.quarantined',
    input: SelfModificationRequest,
    fields: { approval_id?: string; artifact_id?: string; reason?: string },
  ): Promise<void> {
    if (!this.deps.ledger) return;
    await this.deps.ledger.append({
      type,
      run_id: input.runId,
      concept_id: input.conceptId,
      entry_id: input.proposal.entryId,
      proposal_type: input.proposal.record.proposedChangeType,
      ...fields,
    });
  }

  private maxConsecutiveFailures(): number {
    return this.deps.circuitBreaker?.maxConsecutiveFailures ?? 3;
  }
}

function isEvalProofBody(value: unknown): value is {
  runId: string;
  subjectId: string;
  verdict: string;
  status: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.runId === 'string' &&
    typeof body.subjectId === 'string' &&
    typeof body.verdict === 'string' &&
    typeof body.status === 'string'
  );
}
