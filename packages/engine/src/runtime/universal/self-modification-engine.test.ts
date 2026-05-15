import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalDecision } from '../approval-flow';
import { ArtifactStore, type ArtifactRef } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import type { ImprovementProposal } from './meta-critic';
import type { DoubleLoopRecord } from './memory/types';
import { SelfModificationEngine } from './self-modification-engine';

describe('SelfModificationEngine', () => {
  let dir: string;
  let artifactStore: ArtifactStore;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-self-modification-'));
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires human approval and leaves approved self-modification proposal unapplied', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const approvalFlow = approval('approve');
    const engine = new SelfModificationEngine({
      artifactStore,
      ledger,
      approvalFlow,
      clock: () => Date.parse('2026-05-15T00:00:00.000Z'),
    });

    const result = await engine.submit({
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      proposal: proposal(evalRef),
      evalProofRef: evalRef,
    });

    expect(result).toMatchObject({
      status: 'proposal_only_pending_approval',
      reason: 'human_approved_proposal_only_no_auto_apply',
      approvalId: expect.any(String),
      artifactId: expect.any(String),
    });
    expect(approvalFlow.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'self_modification.proposal',
      approval_required: true,
      reason_codes: expect.arrayContaining(['proposal_only_no_auto_apply']),
      budget_scope: 'self_improvement',
    }));
    const envelopeRef = (await artifactStore.list({ runId: 'run-selfmod', kind: 'improvement_proposal' }))
      .find((ref) => ref.id === result.artifactId)!;
    const envelope = await artifactStore.readJSON<{ proposalOnly: boolean; autoApply: boolean; status: string }>(envelopeRef);
    expect(envelope).toMatchObject({
      proposalOnly: true,
      autoApply: false,
      status: 'proposal_only_pending_approval',
    });
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['self_improvement.proposal.escalated']);
  });

  it('quarantines proposals without verified rollback/eval proof before asking approval', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const approvalFlow = approval('approve');
    const engine = new SelfModificationEngine({ artifactStore, ledger, approvalFlow });

    const result = await engine.submit({
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      proposal: { ...proposal(evalRef), rollbackVerified: false },
      evalProofRef: evalRef,
    });

    expect(result).toMatchObject({
      status: 'quarantined',
      reason: 'rollback_not_verified',
    });
    expect(approvalFlow.requestApproval).not.toHaveBeenCalled();
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['self_improvement.proposal.quarantined']);
  });

  it('opens the circuit breaker after repeated invalid self-modification attempts', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const engine = new SelfModificationEngine({
      artifactStore,
      approvalFlow: approval('approve'),
      circuitBreaker: { maxConsecutiveFailures: 2 },
    });
    const invalid = {
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      proposal: { ...proposal(evalRef), evalArtifactId: 'different-artifact' },
      evalProofRef: evalRef,
    };

    await expect(engine.submit(invalid)).resolves.toMatchObject({ status: 'quarantined' });
    await expect(engine.submit(invalid)).resolves.toMatchObject({ status: 'quarantined' });
    await expect(engine.submit(invalid)).resolves.toMatchObject({
      status: 'circuit_open',
      reason: 'self_modification_circuit_open',
    });
  });

  async function evalProof(runId: string, subjectId: string): Promise<ArtifactRef> {
    return artifactStore.writeJSON('test_result', {
      suiteId: 'suite-selfmod',
      conceptId: 'concept-selfmod',
      runId,
      subjectId,
      verdict: 'pass',
      status: 'passed',
    }, { runId });
  }
});

function approval(decision: ApprovalDecision) {
  return {
    requestApproval: vi.fn(async () => decision),
  };
}

function proposal(evalRef: ArtifactRef): ImprovementProposal {
  const record = doubleLoopRecord();
  return {
    schemaVersion: 'pyrfor.improvement_proposal.v1',
    entryId: 'entry-1',
    record,
    evalArtifactId: evalRef.id,
    rollbackVerified: true,
    decision: 'pending',
    decisionReason: 'ready_for_self_modification_shell',
    artifactId: 'proposal-artifact',
    evaluatedAt: '2026-05-15T00:00:00.000Z',
  };
}

function doubleLoopRecord(): DoubleLoopRecord {
  return {
    id: 'double-loop-1',
    kind: 'double_loop',
    provenance: 'native',
    confidence: 'high',
    context: {
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      nodeId: 'node-selfmod',
      nodeHash: 'node-hash',
      algorithm: 'system_self_improvement',
      phase: 'self_improvement',
      nodeKind: 'consequential',
    },
    sourceLessonsArtifactRef: 'lessons-artifact',
    sourceRunId: 'run-selfmod',
    artifactIds: ['lessons-artifact'],
    approvalState: 'pending_approval',
    legacy: false,
    quarantined: false,
    evidence: [{ artifactRef: 'lessons-artifact', verifierConfirmed: true }],
    createdAt: '2026-05-15T00:00:00.000Z',
    author: 'meta_critic',
    proposedChangeType: 'algorithm',
    targetScope: {
      algorithm: 'system_self_improvement',
      phase: 'self_improvement',
      nodeKind: 'consequential',
      ruleKey: 'system_self_improvement.self_modification.shell',
      currentRule: 'proposal-only shell absent',
      proposedRule: 'route self-modification through proof + rollback + human approval shell',
    },
    systemicDefect: 'Self-modification proposals need an explicit M15 shell.',
    expectedImpact: 'Prevent silent auto-apply of self-modification.',
    impact: { predictedScore: 1, riskDelta: 'lower' },
    risks: ['human approval may reject the proposal'],
    rollbackPlan: 'Discard the pending proposal envelope and keep the current runtime unchanged.',
    status: 'candidate',
    similarityKey: 'self-mod-shell',
    requiresNovelEvidenceAfterRejection: true,
  };
}
