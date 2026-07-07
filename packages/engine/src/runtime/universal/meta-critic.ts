import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalRequest } from '../approval-flow';
import type { ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { MemoryEntry, MemoryStore } from '../memory-store';
import { promoteDoubleLoop, quarantineDoubleLoop } from './memory/historian-writer';
import type { DoubleLoopRecord } from './memory/types';
import type { AcceptanceReport, AcceptanceTestSuite } from './tester';
import { assertMetaCriticRunBudget, type MetaCriticRunBudgetGuard } from '../si-run-budget-guard';

export const AUTONOMOUS_ELIGIBLE_TYPES = new Set<DoubleLoopRecord['proposedChangeType']>(['algorithm', 'heuristic']);
export const ALWAYS_HUMAN_TYPES = new Set<DoubleLoopRecord['proposedChangeType']>(['policy', 'budget', 'verifier_rules']);

export interface ImprovementProposal {
  schemaVersion: 'pyrfor.improvement_proposal.v1';
  entryId: string;
  record: DoubleLoopRecord;
  evalArtifactId?: string;
  rollbackVerified: boolean;
  decision: 'promoted' | 'quarantined' | 'escalated_to_human' | 'pending';
  decisionReason: string;
  approvalId?: string;
  artifactId?: string;
  evaluatedAt: string;
}

export interface MetaCriticApprovalFlow {
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface MetaCriticAcceptanceTester {
  run(suite: AcceptanceTestSuite): Promise<AcceptanceReport>;
}

export interface MetaCriticDeps {
  memoryStore: MemoryStore;
  artifactStore: ArtifactStore;
  ledger: EventLedger;
  approvalFlow: MetaCriticApprovalFlow;
  acceptanceTester: MetaCriticAcceptanceTester;
  buildEvalSuite: (record: DoubleLoopRecord, runId: string) => AcceptanceTestSuite;
  clock?: () => number;
  runBudgetGuard?: MetaCriticRunBudgetGuard;
}

export interface MetaCriticRunInput {
  runId: string;
  conceptId?: string;
  ruleKeys?: string[];
  maxProposals?: number;
}

export interface MetaCriticRunResult {
  evaluated: number;
  promoted: number;
  quarantined: number;
  escalated: number;
  proposalArtifactIds: string[];
}

export class MetaCriticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaCriticValidationError';
  }
}

export class MetaCritic {
  constructor(private readonly deps: MetaCriticDeps) {}

  async run(input: MetaCriticRunInput): Promise<MetaCriticRunResult> {
    if (!input.runId.trim()) throw new MetaCriticValidationError('runId is required');
    if (this.deps.runBudgetGuard) {
      await assertMetaCriticRunBudget(this.deps.runBudgetGuard, input.runId);
    }
    const maxProposals = input.maxProposals ?? 5;
    if (!Number.isInteger(maxProposals) || maxProposals < 1) {
      throw new MetaCriticValidationError('maxProposals must be a positive integer');
    }
    const candidates = this.findCandidateEntries(input.ruleKeys);
    const result: MetaCriticRunResult = {
      evaluated: 0,
      promoted: 0,
      quarantined: 0,
      escalated: 0,
      proposalArtifactIds: [],
    };

    for (const entry of candidates) {
      if (result.evaluated >= maxProposals) break;
      let proposal: ImprovementProposal;
      try {
        proposal = await this.evaluateEntryCore(entry.id, input.runId, input.conceptId);
      } catch (error) {
        if (!(error instanceof MetaCriticValidationError)) throw error;
        await this.quarantineMalformedCandidate(entry, input.runId, input.conceptId, error.message);
        result.quarantined += 1;
        continue;
      }
      result.evaluated += 1;
      if (proposal.decision === 'promoted') result.promoted += 1;
      if (proposal.decision === 'quarantined') result.quarantined += 1;
      if (proposal.decision === 'escalated_to_human') result.escalated += 1;
      if (proposal.artifactId) result.proposalArtifactIds.push(proposal.artifactId);
    }

    return result;
  }

  async evaluateEntry(entryId: string, runId: string, conceptId?: string): Promise<ImprovementProposal> {
    return this.evaluateEntryCore(entryId, runId, conceptId);
  }

  private async evaluateEntryCore(entryId: string, runId: string, conceptId?: string): Promise<ImprovementProposal> {
    if (!entryId.trim()) throw new MetaCriticValidationError('entryId is required');
    if (!runId.trim()) throw new MetaCriticValidationError('runId is required');
    const entry = this.deps.memoryStore.get(entryId);
    if (!entry) throw new MetaCriticValidationError(`double-loop entry not found: ${entryId}`);
    const record = parseCandidateDoubleLoop(entry);

    if (ALWAYS_HUMAN_TYPES.has(record.proposedChangeType)) {
      const approvalId = randomUUID();
      await this.deps.approvalFlow.requestApproval({
        id: approvalId,
        toolName: 'self_improvement.proposal',
        summary: `Human approval required for ${record.proposedChangeType} self-improvement`,
        args: {
          entryId,
          proposedChangeType: record.proposedChangeType,
          ruleKey: record.targetScope.ruleKey,
          proposedRule: record.targetScope.proposedRule,
        },
        run_id: runId,
        concept_id: conceptId ?? record.context.conceptId,
        engine_phase: 'self_improvement',
        reason_codes: ['policy_change_requires_human', 'self_improvement_gate'],
      });
      const proposal = await this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
        decision: 'escalated_to_human',
        decisionReason: 'policy_change_requires_human',
        rollbackVerified: false,
        approvalId,
      }));
      this.markPendingApproval(entry, record, approvalId);
      await this.deps.ledger.append({
        type: 'self_improvement.proposal.escalated',
        run_id: runId,
        concept_id: conceptId ?? record.context.conceptId,
        entry_id: entryId,
        proposal_type: record.proposedChangeType,
        approval_id: approvalId,
        artifact_id: proposal.artifactId,
        reason: 'policy_change_requires_human',
      });
      return proposal;
    }

    if (!AUTONOMOUS_ELIGIBLE_TYPES.has(record.proposedChangeType)) {
      throw new MetaCriticValidationError(`unsupported proposedChangeType: ${record.proposedChangeType}`);
    }

    if (!record.rollbackPlan.trim()) {
      const proposal = await this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
        decision: 'quarantined',
        decisionReason: 'missing_rollback_plan',
        rollbackVerified: false,
      }));
      await quarantineDoubleLoop(entryId, 'missing_rollback_plan', this.deps);
      await this.deps.ledger.append({
        type: 'self_improvement.proposal.quarantined',
        run_id: runId,
        concept_id: conceptId ?? record.context.conceptId,
        entry_id: entryId,
        proposal_type: record.proposedChangeType,
        artifact_id: proposal.artifactId,
        reason: 'missing_rollback_plan',
      });
      return proposal;
    }

    if (this.hasRejectedDuplicate(record, entryId)) {
      const proposal = await this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
        decision: 'quarantined',
        decisionReason: 'thrash_guard_near_duplicate',
        rollbackVerified: true,
      }));
      await quarantineDoubleLoop(entryId, 'thrash_guard_near_duplicate', this.deps);
      await this.deps.ledger.append({
        type: 'self_improvement.proposal.quarantined',
        run_id: runId,
        concept_id: conceptId ?? record.context.conceptId,
        entry_id: entryId,
        proposal_type: record.proposedChangeType,
        artifact_id: proposal.artifactId,
        reason: 'thrash_guard_near_duplicate',
      });
      return proposal;
    }

    const report = await this.deps.acceptanceTester.run(this.deps.buildEvalSuite(record, runId));
    await this.deps.ledger.append({
      type: 'self_improvement.proposal.evaluated',
      run_id: runId,
      concept_id: conceptId ?? record.context.conceptId,
      entry_id: entryId,
      proposal_type: record.proposedChangeType,
      eval_verdict: report.verdict,
      artifact_id: report.artifactId,
    });

    const invalidProofReason = report.verdict === 'pass'
      ? await this.validateEvaluationProof(report, runId, record)
      : undefined;
    if (report.verdict === 'pass' && invalidProofReason === undefined) {
      const proposal = await this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
        decision: 'promoted',
        decisionReason: 'eval_passed',
        rollbackVerified: true,
        evalArtifactId: report.artifactId,
      }));
      await promoteDoubleLoop(entryId, 'meta-critic', this.deps);
      await this.deps.ledger.append({
        type: 'self_improvement.proposal.promoted',
        run_id: runId,
        concept_id: conceptId ?? record.context.conceptId,
        entry_id: entryId,
        proposal_type: record.proposedChangeType,
        eval_verdict: report.verdict,
        artifact_id: report.artifactId,
        approved_by: 'meta-critic',
      });
      return proposal;
    }

    const decisionReason = invalidProofReason ?? `eval_failed:${report.verdict}`;
    const proposal = await this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
      decision: 'quarantined',
      decisionReason,
      rollbackVerified: true,
      evalArtifactId: report.artifactId,
    }));
    await quarantineDoubleLoop(entryId, decisionReason, this.deps);
    await this.deps.ledger.append({
      type: 'self_improvement.proposal.quarantined',
      run_id: runId,
      concept_id: conceptId ?? record.context.conceptId,
      entry_id: entryId,
      proposal_type: record.proposedChangeType,
      eval_verdict: report.verdict,
      artifact_id: report.artifactId,
      reason: decisionReason,
    });
    return proposal;
  }

  private findCandidateEntries(ruleKeys?: string[]): MemoryEntry[] {
    return this.deps.memoryStore.query({
      kind: 'lesson',
      tags: ['double_loop', 'candidate'],
      limit: 100,
    }).filter((entry) => {
      if (!ruleKeys?.length) return true;
      let record: DoubleLoopRecord;
      try {
        record = parseCandidateDoubleLoop(entry);
      } catch {
        return false;
      }
      return ruleKeys.includes(record.targetScope.ruleKey);
    });
  }

  private hasRejectedDuplicate(record: DoubleLoopRecord, currentEntryId: string): boolean {
    if (!record.requiresNovelEvidenceAfterRejection) return false;
    return this.deps.memoryStore.query({
      kind: 'lesson',
      tags: ['double_loop', 'quarantined'],
      limit: 100,
    }).some((entry) => {
      if (entry.id === currentEntryId) return false;
      try {
        return JSON.parse(entry.text).similarityKey === record.similarityKey;
      } catch {
        return false;
      }
    });
  }

  private proposal(
    entryId: string,
    record: DoubleLoopRecord,
    fields: Omit<ImprovementProposal, 'schemaVersion' | 'entryId' | 'record' | 'evaluatedAt'>,
  ): ImprovementProposal {
    return {
      schemaVersion: 'pyrfor.improvement_proposal.v1',
      entryId,
      record,
      evaluatedAt: new Date((this.deps.clock ?? Date.now)()).toISOString(),
      ...fields,
    };
  }

  private async writeProposal(runId: string, conceptId: string | undefined, proposal: ImprovementProposal): Promise<ImprovementProposal> {
    const ref = await this.deps.artifactStore.writeJSON('improvement_proposal', proposal, {
      runId,
      meta: {
        entryId: proposal.entryId,
        decision: proposal.decision,
        ...(conceptId ? { conceptId } : {}),
      },
    });
    return { ...proposal, artifactId: ref.id };
  }

  private async quarantineMalformedCandidate(
    entry: MemoryEntry,
    runId: string,
    conceptId: string | undefined,
    reason: string,
  ): Promise<void> {
    const nextTags = new Set(entry.tags.filter((tag) => tag !== 'candidate'));
    nextTags.add('quarantined');
    nextTags.add('malformed_double_loop');
    this.deps.memoryStore.update(entry.id, {
      tags: [...nextTags],
      weight: Math.min(entry.weight, 0.1),
    });
    await this.deps.ledger.append({
      type: 'self_improvement.proposal.quarantined',
      run_id: runId,
      ...(conceptId ? { concept_id: conceptId } : {}),
      entry_id: entry.id,
      reason: `malformed_candidate:${reason}`,
    });
  }

  private markPendingApproval(entry: MemoryEntry, record: DoubleLoopRecord, approvalId: string): void {
    const nextRecord: DoubleLoopRecord = {
      ...record,
      status: 'pending_approval',
      approvalFlowRef: approvalId,
    };
    const nextTags = new Set(entry.tags.filter((tag) => tag !== 'candidate'));
    nextTags.add('pending_approval');
    nextTags.add('escalated');
    const updated = this.deps.memoryStore.update(entry.id, {
      text: JSON.stringify(nextRecord),
      tags: [...nextTags],
    });
    if (!updated) throw new MetaCriticValidationError(`failed to mark entry pending approval: ${entry.id}`);
  }

  private async validateEvaluationProof(
    report: AcceptanceReport,
    runId: string,
    record: DoubleLoopRecord,
  ): Promise<string | undefined> {
    if (report.runId !== runId) return 'invalid_eval_proof:run_mismatch';
    if (report.subjectId !== record.id) return 'invalid_eval_proof:subject_mismatch';
    if (report.status !== 'passed') return 'invalid_eval_proof:status_mismatch';
    if (report.artifactId !== report.artifactRef.id) return 'invalid_eval_proof:artifact_mismatch';
    if (report.artifactRef.kind !== 'test_result') return 'invalid_eval_proof:not_test_result';
    if (report.artifactRef.runId !== runId) return 'invalid_eval_proof:artifact_run_mismatch';
    if (!report.artifactRef.sha256) return 'invalid_eval_proof:missing_sha256';
    if (!(await this.deps.artifactStore.exists(report.artifactRef))) return 'invalid_eval_proof:missing_artifact';
    let proof: unknown;
    try {
      proof = JSON.parse((await this.deps.artifactStore.readVerified(report.artifactRef, report.artifactRef.sha256)).toString('utf-8'));
    } catch {
      return 'invalid_eval_proof:unverified_artifact';
    }
    if (!isAcceptanceProofBody(proof)) return 'invalid_eval_proof:invalid_payload';
    if (proof.runId !== runId) return 'invalid_eval_proof:payload_run_mismatch';
    if (proof.subjectId !== record.id) return 'invalid_eval_proof:payload_subject_mismatch';
    if (proof.suiteId !== report.suiteId) return 'invalid_eval_proof:payload_suite_mismatch';
    if (proof.verdict !== 'pass' || proof.status !== 'passed') return 'invalid_eval_proof:payload_verdict_mismatch';
    return undefined;
  }
}

function isAcceptanceProofBody(value: unknown): value is {
  suiteId: string;
  runId: string;
  subjectId: string;
  verdict: string;
  status: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.suiteId === 'string' &&
    typeof body.runId === 'string' &&
    typeof body.subjectId === 'string' &&
    typeof body.verdict === 'string' &&
    typeof body.status === 'string'
  );
}

function parseCandidateDoubleLoop(entry: MemoryEntry): DoubleLoopRecord {
  if (entry.kind !== 'lesson' || !entry.tags.includes('double_loop') || !entry.tags.includes('candidate')) {
    throw new MetaCriticValidationError(`entry is not a candidate double-loop lesson: ${entry.id}`);
  }
  const parsed = JSON.parse(entry.text) as Partial<DoubleLoopRecord>;
  if (
    parsed.kind !== 'double_loop' ||
    typeof parsed.id !== 'string' ||
    parsed.status !== 'candidate' ||
    typeof parsed.proposedChangeType !== 'string' ||
    typeof parsed.rollbackPlan !== 'string' ||
    typeof parsed.similarityKey !== 'string' ||
    parsed.targetScope === undefined ||
    typeof parsed.targetScope.ruleKey !== 'string' ||
    typeof parsed.targetScope.proposedRule !== 'string' ||
    parsed.context === undefined ||
    typeof parsed.context.runId !== 'string'
  ) {
    throw new MetaCriticValidationError(`entry does not contain a valid candidate double-loop record: ${entry.id}`);
  }
  return parsed as DoubleLoopRecord;
}
