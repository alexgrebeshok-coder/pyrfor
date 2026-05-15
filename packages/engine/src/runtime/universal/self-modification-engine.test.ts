import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../ai/circuit-breaker';
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

  it('enqueues human approval and leaves self-modification proposal unapplied', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const decisionRecordRef = await artifactStore.writeJSON('decision_record', { ok: true }, { runId: 'run-selfmod' });
    const gateRef = await artifactStore.writeJSON('gate_check_report', { ok: true }, { runId: 'run-selfmod' });
    const approvalFlow = approval();
    const engine = new SelfModificationEngine({
      artifactStore,
      ledger,
      approvalFlow,
      circuitBreaker: circuitBreaker(),
      clock: () => Date.parse('2026-05-15T00:00:00.000Z'),
    });

    const result = await engine.metaOptimize({
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      conceptKind: 'meta.improvement',
      projectId: 'p1',
      proposal: proposal(evalRef),
      evalProofRef: evalRef,
      decisionRecordRef,
      completionGateResultRef: gateRef,
    });

    expect(result).toMatchObject({
      status: 'pending_human_approval',
      reason: 'proposal_only_no_auto_apply',
      approvalId: expect.any(String),
      artifactId: expect.any(String),
    });
    expect(approvalFlow.enqueueApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'self_modification.meta_change',
      approval_required: true,
      reason_codes: expect.arrayContaining(['proposal_only_no_auto_apply']),
      budget_scope: 'self_improvement',
    }));
    const envelopeRef = (await artifactStore.list({ runId: 'run-selfmod', kind: 'governance_adjustment_proposal' }))
      .find((ref) => ref.id === result.artifactId)!;
    const envelope = await artifactStore.readJSON<{ proposalOnly: boolean; autoApply: boolean; status: string }>(envelopeRef);
    expect(envelope).toMatchObject({
      proposalOnly: true,
      autoApply: false,
      status: 'pending_human_approval',
    });
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['self_improvement.meta_change.proposed']);
  });

  it('rejects proposals without verified rollback/eval proof before asking approval', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const decisionRecordRef = await artifactStore.writeJSON('decision_record', { ok: true }, { runId: 'run-selfmod' });
    const gateRef = await artifactStore.writeJSON('gate_check_report', { ok: true }, { runId: 'run-selfmod' });
    const approvalFlow = approval();
    const engine = new SelfModificationEngine({
      artifactStore,
      ledger,
      approvalFlow,
      circuitBreaker: circuitBreaker(),
    });

    await expect(engine.metaOptimize({
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      conceptKind: 'meta.improvement',
      projectId: 'p1',
      proposal: { ...proposal(evalRef), rollbackVerified: false },
      evalProofRef: evalRef,
      decisionRecordRef,
      completionGateResultRef: gateRef,
    })).rejects.toThrow('rollback must be verified');

    expect(approvalFlow.enqueueApproval).not.toHaveBeenCalled();
    expect(await ledger.readAll()).toEqual([]);
  });

  it('blocks protected targets and opens the circuit breaker through the existing circuit', async () => {
    const evalRef = await evalProof('run-selfmod', 'double-loop-1');
    const decisionRecordRef = await artifactStore.writeJSON('decision_record', { ok: true }, { runId: 'run-selfmod' });
    const gateRef = await artifactStore.writeJSON('gate_check_report', { ok: true }, { runId: 'run-selfmod' });
    const breaker = circuitBreaker(1);
    const approvalFlow = approval();
    const engine = new SelfModificationEngine({
      artifactStore,
      ledger,
      approvalFlow,
      circuitBreaker: breaker,
    });
    const protectedProposal = proposal(evalRef, 'runtime.verifier_rules.thresholds');
    const request = {
      runId: 'run-selfmod',
      conceptId: 'concept-selfmod',
      conceptKind: 'meta.improvement' as const,
      projectId: 'p1',
      proposal: protectedProposal,
      evalProofRef: evalRef,
      decisionRecordRef,
      completionGateResultRef: gateRef,
    };

    await expect(engine.metaOptimize(request)).rejects.toThrow(/protected target: verifier_rules/);
    await expect(engine.metaOptimize(request)).rejects.toBeInstanceOf(CircuitOpenError);
    expect((await ledger.readAll()).map((event) => event.type)).toEqual([
      'self_improvement.meta_change.protected_target_rejected',
      'self_improvement.meta_change.protected_target_rejected',
      'self_improvement.meta_change.circuit_open',
    ]);
    expect(approvalFlow.enqueueApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'self_modification.circuit_open',
    }));
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

function approval() {
  return {
    enqueueApproval: vi.fn(async (req) => ({ id: req.id ?? 'approval-id', ...req })),
  };
}

function circuitBreaker(failureThreshold = 3): CircuitBreaker {
  return new CircuitBreaker(`self-mod-test-${Math.random()}`, {
    failureThreshold,
    resetTimeout: 60_000,
    halfOpenMax: 1,
    executionTimeoutMs: 10_000,
  });
}

function proposal(evalRef: ArtifactRef, ruleKey?: string): ImprovementProposal {
  const record = doubleLoopRecord(ruleKey);
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

function doubleLoopRecord(ruleKey = 'system_self_improvement.self_modification.shell'): DoubleLoopRecord {
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
      ruleKey,
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
