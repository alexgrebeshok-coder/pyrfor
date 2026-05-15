import { randomUUID } from 'node:crypto';
import { CircuitBreaker, CircuitOpenError, getCircuitBreaker } from '../../ai/circuit-breaker';
import type { ApprovalRequest } from '../approval-flow';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ImprovementProposal } from './meta-critic';
import { assertOptimizerTargetEditable } from './optimizer-specializations';

export interface SelfModificationApprovalFlow {
  enqueueApproval(req: Omit<ApprovalRequest, 'id'> & { id?: string }): Promise<ApprovalRequest>;
}

export interface SelfModificationEngineDeps {
  artifactStore: ArtifactStore;
  approvalFlow: SelfModificationApprovalFlow;
  ledger: EventLedger;
  circuitBreaker?: CircuitBreaker;
  clock?: () => number;
}

export interface SelfModificationRequest {
  runId: string;
  conceptId: string;
  conceptKind: 'meta.improvement';
  projectId: string;
  proposal: ImprovementProposal;
  evalProofRef: ArtifactRef;
  decisionRecordRef: ArtifactRef;
  completionGateResultRef: ArtifactRef;
  metaMeta?: boolean;
}

export interface SelfModificationResult {
  status: 'pending_human_approval';
  reason: 'proposal_only_no_auto_apply';
  approvalId: string;
  artifactId: string;
}

export class SelfModificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfModificationValidationError';
  }
}

export class SelfModificationEngine {
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private readonly deps: SelfModificationEngineDeps) {
    this.circuitBreaker = deps.circuitBreaker ?? getCircuitBreaker('self_modification_engine', {
      failureThreshold: 3,
      resetTimeout: 3_600_000,
      halfOpenMax: 1,
      executionTimeoutMs: 45_000,
    });
  }

  async metaOptimize(input: SelfModificationRequest): Promise<SelfModificationResult> {
    await this.validate(input);
    try {
      assertOptimizerTargetEditable(input.proposal.record.targetScope.ruleKey);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.emitMetaChange('self_improvement.meta_change.protected_target_rejected', input, { reason });
      try {
        await this.tripCircuit(reason);
      } catch (circuitError) {
        if (circuitError instanceof CircuitOpenError) {
          await this.escalateCircuitOpen(input.runId, input.conceptId, circuitError.message);
          throw circuitError;
        }
        throw circuitError;
      }
      throw new SelfModificationValidationError(reason);
    }

    try {
      return await this.circuitBreaker.execute(() => this.writeAndEnqueue(input));
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        await this.escalateCircuitOpen(input.runId, input.conceptId, error.message);
      }
      throw error;
    }
  }

  async recordMetaChangeRejection(runId: string, conceptId: string, reason: string): Promise<void> {
    try {
      await this.tripCircuit(reason);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        await this.escalateCircuitOpen(runId, conceptId, error.message);
      }
    }
  }

  private async writeAndEnqueue(input: SelfModificationRequest): Promise<SelfModificationResult> {
    const approvalId = randomUUID();
    const ref = await this.deps.artifactStore.writeJSON('governance_adjustment_proposal', {
      schemaVersion: 'pyrfor.self_modification_envelope.v2',
      proposal: input.proposal,
      projectId: input.projectId,
      evalProofRef: input.evalProofRef,
      decisionRecordRef: input.decisionRecordRef,
      completionGateResultRef: input.completionGateResultRef,
      approvalId,
      status: 'pending_human_approval',
      proposalOnly: true,
      autoApply: false,
      metaMeta: input.metaMeta === true,
      generatedAt: new Date((this.deps.clock ?? Date.now)()).toISOString(),
    }, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        entryId: input.proposal.entryId,
        approvalId,
        status: 'pending_human_approval',
      },
    });
    await this.emitMetaChange('self_improvement.meta_change.proposed', input, {
      approval_id: approvalId,
      artifact_id: ref.id,
      reason: 'proposal_only_no_auto_apply',
    });
    await this.deps.approvalFlow.enqueueApproval({
      id: approvalId,
      toolName: 'self_modification.meta_change',
      summary: input.metaMeta
        ? `Human approval required for meta-meta self-modification proposal: ${input.proposal.record.targetScope.ruleKey}`
        : `Human approval required for self-modification proposal: ${input.proposal.record.targetScope.ruleKey}`,
      args: {
        entryId: input.proposal.entryId,
        proposalType: input.proposal.record.proposedChangeType,
        ruleKey: input.proposal.record.targetScope.ruleKey,
        evalProofArtifactId: input.evalProofRef.id,
        decisionRecordArtifactId: input.decisionRecordRef.id,
        completionGateResultArtifactId: input.completionGateResultRef.id,
        rollbackPlan: input.proposal.record.rollbackPlan,
        proposalOnly: true,
        autoApply: false,
      },
      run_id: input.runId,
      concept_id: input.conceptId,
      engine_phase: 'self_improvement',
      reason_codes: ['self_modification_gate', 'human_approval_required', 'proposal_only_no_auto_apply'],
      approval_required: true,
      budget_scope: 'self_improvement',
    });
    return {
      status: 'pending_human_approval',
      reason: 'proposal_only_no_auto_apply',
      approvalId,
      artifactId: ref.id,
    };
  }

  private async validate(input: SelfModificationRequest): Promise<void> {
    if (!input.runId.trim()) throw new SelfModificationValidationError('runId is required');
    if (!input.conceptId.trim()) throw new SelfModificationValidationError('conceptId is required');
    if (input.conceptKind !== 'meta.improvement') {
      throw new SelfModificationValidationError('SelfModificationEngine must run as a meta.improvement concept');
    }
    if (!input.projectId.trim() || input.projectId === '*') {
      throw new SelfModificationValidationError('projectId is required and cannot be wildcard');
    }
    if (input.proposal.schemaVersion !== 'pyrfor.improvement_proposal.v1') {
      throw new SelfModificationValidationError('invalid proposal schema version');
    }
    if (!input.proposal.record.rollbackPlan.trim()) throw new SelfModificationValidationError('rollbackPlan is required');
    if (!input.proposal.rollbackVerified) throw new SelfModificationValidationError('rollback must be verified');
    if (input.proposal.evalArtifactId !== input.evalProofRef.id) {
      throw new SelfModificationValidationError('eval proof artifact mismatch');
    }
    await this.validateArtifactRef(input.evalProofRef, input.runId, 'test_result');
    await this.validateArtifactRef(input.decisionRecordRef, input.runId, 'decision_record');
    await this.validateArtifactRef(input.completionGateResultRef, input.runId, 'gate_check_report');
    const proof = await this.deps.artifactStore.readJSONVerified(input.evalProofRef, input.evalProofRef.sha256!);
    if (!isEvalProofBody(proof)) throw new SelfModificationValidationError('invalid eval proof payload');
    if (proof.runId !== input.runId) throw new SelfModificationValidationError('eval proof run mismatch');
    if (proof.subjectId !== input.proposal.record.id) throw new SelfModificationValidationError('eval proof subject mismatch');
    if (proof.verdict !== 'pass' || proof.status !== 'passed') {
      throw new SelfModificationValidationError('eval proof did not pass');
    }
  }

  private async validateArtifactRef(ref: ArtifactRef, runId: string, kind: ArtifactRef['kind']): Promise<void> {
    if (ref.kind !== kind) throw new SelfModificationValidationError(`${kind} artifact is required`);
    if (ref.runId !== runId) throw new SelfModificationValidationError(`${kind} run mismatch`);
    if (!ref.sha256) throw new SelfModificationValidationError(`${kind} missing sha256`);
    if (!(await this.deps.artifactStore.exists(ref))) throw new SelfModificationValidationError(`${kind} artifact missing`);
  }

  private async tripCircuit(reason: string): Promise<void> {
    await this.circuitBreaker.execute(async () => {
      throw new SelfModificationValidationError(reason);
    });
  }

  private async escalateCircuitOpen(runId: string, conceptId: string, reason: string): Promise<void> {
    const approvalId = randomUUID();
    await this.deps.ledger.append({
      type: 'self_improvement.meta_change.circuit_open',
      run_id: runId,
      concept_id: conceptId,
      approval_id: approvalId,
      reason,
    });
    await this.deps.approvalFlow.enqueueApproval({
      id: approvalId,
      toolName: 'self_modification.circuit_open',
      summary: `Self-modification circuit is open: ${reason}`,
      args: { reason, proposalOnly: true },
      run_id: runId,
      concept_id: conceptId,
      engine_phase: 'self_improvement',
      reason_codes: ['self_modification_circuit_open', 'human_approval_required'],
      approval_required: true,
      budget_scope: 'self_improvement',
    });
  }

  private async emitMetaChange(
    type:
      | 'self_improvement.meta_change.proposed'
      | 'self_improvement.meta_change.protected_target_rejected',
    input: SelfModificationRequest,
    fields: { approval_id?: string; artifact_id?: string; reason?: string },
  ): Promise<void> {
    await this.deps.ledger.append({
      type,
      run_id: input.runId,
      concept_id: input.conceptId,
      proposal_id: input.proposal.entryId,
      target_key: input.proposal.record.targetScope.ruleKey,
      ...fields,
    });
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
