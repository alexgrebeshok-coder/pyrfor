import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { MetaCritic, type MetaCriticAcceptanceTester } from './meta-critic';
import type { AcceptanceReport, AcceptanceTestSuite } from './tester';
import type { DoubleLoopRecord } from './memory/types';

describe('MetaCritic', () => {
  let dir: string;
  let memoryStore: MemoryStore;
  let artifactStore: ArtifactStore;
  let ledger: EventLedger;
  let acceptanceTester: MetaCriticAcceptanceTester;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-meta-critic-'));
    memoryStore = createMemoryStore({ dbPath: ':memory:' });
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
    acceptanceTester = {
      run: vi.fn(async (suite) => persistedAcceptanceReport('pass', {
        suiteId: suite.suiteId,
        conceptId: suite.conceptId,
        runId: suite.runId,
        subjectId: suite.subjectId,
      })),
    };
  });

  afterEach(async () => {
    memoryStore.close();
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('escalates policy, budget, and verifier-rule proposals to human approval without promotion', async () => {
    const ids = [
      addCandidate(record({ id: 'policy-record', proposedChangeType: 'policy' })),
      addCandidate(record({ id: 'budget-record', proposedChangeType: 'budget' })),
      addCandidate(record({ id: 'verifier-record', proposedChangeType: 'verifier_rules' })),
    ];
    const approvalFlow = { requestApproval: vi.fn(async () => 'deny' as const) };
    const critic = metaCritic({ approvalFlow });

    const result = await critic.run({ runId: 'run-meta', maxProposals: 3 });

    expect(result).toMatchObject({ evaluated: 3, promoted: 0, quarantined: 0, escalated: 3 });
    expect(approvalFlow.requestApproval).toHaveBeenCalledTimes(3);
    for (const id of ids) {
      expect(memoryStore.get(id)?.tags).toContain('pending_approval');
      expect(memoryStore.get(id)?.tags).not.toContain('candidate');
      expect(JSON.parse(memoryStore.get(id)!.text)).toMatchObject({ status: 'pending_approval' });
    }
    expect((await ledger.readAll()).filter((event) => event.type === 'self_improvement.proposal.escalated')).toHaveLength(3);

    const secondRun = await critic.run({ runId: 'run-meta', maxProposals: 3 });
    expect(secondRun).toMatchObject({ evaluated: 0, promoted: 0, quarantined: 0, escalated: 0 });
    expect(approvalFlow.requestApproval).toHaveBeenCalledTimes(3);
  });

  it('promotes algorithm proposals only after passing eval proof and rollback plan', async () => {
    const id = addCandidate(record({ proposedChangeType: 'algorithm', rollbackPlan: 'restore previous rule' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({
      decision: 'promoted',
      evalArtifactId: expect.stringMatching(/\.json$/),
      rollbackVerified: true,
    });
    expect(memoryStore.get(id)?.tags).toContain('approved');
    expect(JSON.parse(memoryStore.get(id)!.text)).toMatchObject({ status: 'approved' });
    expect((await ledger.readAll()).map((event) => event.type)).toEqual([
      'self_improvement.proposal.evaluated',
      'memory.written',
      'self_improvement.proposal.promoted',
    ]);
    await expect(artifactStore.list({ runId: 'run-meta', kind: 'improvement_proposal' })).resolves.toHaveLength(1);
  });

  it('quarantines algorithm proposals when eval proof fails', async () => {
    acceptanceTester = { run: vi.fn(async () => acceptanceReport('block')) };
    const id = addCandidate(record({ proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'eval_failed:block' });
    expect(memoryStore.get(id)?.tags).toContain('quarantined');
    expect((await ledger.readAll()).map((event) => event.type)).toContain('self_improvement.proposal.quarantined');
  });

  it('quarantines passing evals with an invalid proof artifact kind', async () => {
    acceptanceTester = {
      run: vi.fn(async () => ({
        ...acceptanceReport('pass'),
        artifactRef: { ...acceptanceReport('pass').artifactRef, kind: 'verification_report' },
      })),
    };
    const id = addCandidate(record({ proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'invalid_eval_proof:not_test_result' });
    expect(memoryStore.get(id)?.tags).toContain('quarantined');
    expect(memoryStore.get(id)?.tags).not.toContain('approved');
  });

  it('quarantines passing evals with forged proof artifacts missing from ArtifactStore', async () => {
    acceptanceTester = {
      run: vi.fn(async () => ({
        ...acceptanceReport('pass'),
        artifactRef: { ...acceptanceReport('pass').artifactRef, sha256: 'forged-sha256' },
      })),
    };
    const id = addCandidate(record({ proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'invalid_eval_proof:missing_artifact' });
    expect(memoryStore.get(id)?.tags).toContain('quarantined');
    expect(memoryStore.get(id)?.tags).not.toContain('approved');
  });

  it('quarantines replayed passing proof artifacts for a different subject', async () => {
    acceptanceTester = {
      run: vi.fn(async () => {
        const replayed = await persistedAcceptanceReport('pass', { subjectId: 'other-double-loop' });
        return { ...replayed, subjectId: 'double-loop-1' };
      }),
    };
    const id = addCandidate(record({ proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'invalid_eval_proof:payload_subject_mismatch' });
    expect(memoryStore.get(id)?.tags).toContain('quarantined');
    expect(memoryStore.get(id)?.tags).not.toContain('approved');
  });

  it('quarantines existing proof artifacts with mismatched sha instead of throwing', async () => {
    acceptanceTester = {
      run: vi.fn(async () => {
        const persisted = await persistedAcceptanceReport('pass');
        return { ...persisted, artifactRef: { ...persisted.artifactRef, sha256: 'wrong-sha256' } };
      }),
    };
    const id = addCandidate(record({ proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'invalid_eval_proof:unverified_artifact' });
    expect(memoryStore.get(id)?.tags).toContain('quarantined');
  });

  it('quarantines missing rollback plans without running eval', async () => {
    const id = addCandidate(record({ proposedChangeType: 'heuristic', rollbackPlan: '' }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'missing_rollback_plan', rollbackVerified: false });
    expect(acceptanceTester.run).not.toHaveBeenCalled();
  });

  it('quarantines near-duplicate rejected proposals before eval', async () => {
    addQuarantined(record({ id: 'old-record', similarityKey: 'same-key' }));
    const id = addCandidate(record({ id: 'new-record', similarityKey: 'same-key', requiresNovelEvidenceAfterRejection: true }));
    const critic = metaCritic();

    const proposal = await critic.evaluateEntry(id, 'run-meta');

    expect(proposal).toMatchObject({ decision: 'quarantined', decisionReason: 'thrash_guard_near_duplicate' });
    expect(acceptanceTester.run).not.toHaveBeenCalled();
  });

  it('runs batches with counts and ruleKey filtering', async () => {
    addCandidate(record({ id: 'a', proposedChangeType: 'algorithm', targetScope: { ...baseTargetScope(), ruleKey: 'rule-a' } }));
    addCandidate(record({ id: 'b', proposedChangeType: 'heuristic', targetScope: { ...baseTargetScope(), ruleKey: 'rule-b' } }));
    addCandidate(record({ id: 'c', proposedChangeType: 'policy', targetScope: { ...baseTargetScope(), ruleKey: 'rule-c' } }));
    const critic = metaCritic();

    const result = await critic.run({ runId: 'run-meta', ruleKeys: ['rule-a', 'rule-b'], maxProposals: 5 });

    expect(result).toMatchObject({ evaluated: 2, promoted: 2, quarantined: 0, escalated: 0 });
    expect(result.proposalArtifactIds).toHaveLength(2);
  });

  it('quarantines malformed candidates without aborting later valid proposals', async () => {
    const malformedId = addMalformedCandidate();
    addCandidate(record({ id: 'valid-after-malformed', proposedChangeType: 'algorithm' }));
    const critic = metaCritic();

    const result = await critic.run({ runId: 'run-meta', maxProposals: 1 });

    expect(result).toMatchObject({ evaluated: 1, promoted: 1, quarantined: 1, escalated: 0 });
    expect(memoryStore.get(malformedId)?.tags).toEqual(expect.arrayContaining(['quarantined', 'malformed_double_loop']));
    expect(result.proposalArtifactIds).toHaveLength(1);
  });

  function metaCritic(overrides: Partial<ConstructorParameters<typeof MetaCritic>[0]> = {}): MetaCritic {
    return new MetaCritic({
      memoryStore,
      artifactStore,
      ledger,
      approvalFlow: { requestApproval: vi.fn(async () => 'approve' as const) },
      acceptanceTester,
      buildEvalSuite: (doubleLoop, runId) => suite(doubleLoop, runId),
      clock: () => 0,
      ...overrides,
    });
  }

  function addCandidate(doubleLoop: DoubleLoopRecord): string {
    const entry = memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify(doubleLoop),
      source: 'historian:run-1',
      scope: 'universal',
      tags: [
        'double_loop',
        'candidate',
        doubleLoop.proposedChangeType,
        doubleLoop.targetScope.ruleKey,
        `approvalState:${doubleLoop.approvalState}`,
        'runId:run-1',
        'sourceRunId:run-1',
        'nodeId:node-1',
        'artifactRef:artifact-1',
        'artifactId:artifact-1',
      ],
      weight: 0.8,
    });
    return entry.id;
  }

  function addQuarantined(doubleLoop: DoubleLoopRecord): string {
    const quarantined = {
      ...doubleLoop,
      approvalState: 'quarantined' as const,
      quarantined: true,
      status: 'quarantined' as const,
    };
    const entry = memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify(quarantined),
      source: 'historian:run-1',
      scope: 'universal',
      tags: ['double_loop', 'quarantined', 'approvalState:quarantined', doubleLoop.targetScope.ruleKey],
      weight: 0.2,
    });
    return entry.id;
  }

  function addMalformedCandidate(): string {
    const entry = memoryStore.add({
      kind: 'lesson',
      text: '{"kind":"double_loop","status":"candidate"}',
      source: 'historian:run-1',
      scope: 'universal',
      tags: ['double_loop', 'candidate'],
      weight: 0.8,
    });
    return entry.id;
  }

  async function persistedAcceptanceReport(
    verdict: AcceptanceReport['verdict'],
    overrides: Partial<AcceptanceReport> = {},
  ): Promise<AcceptanceReport> {
    const body = {
      ...acceptanceReport(verdict),
      ...overrides,
    };
    const { artifactId: _artifactId, artifactRef: _artifactRef, ...artifactBody } = body;
    const ref = await artifactStore.writeJSON('test_result', artifactBody, { runId: body.runId });
    return { ...body, artifactId: ref.id, artifactRef: ref };
  }
});

function record(overrides: Partial<DoubleLoopRecord> = {}): DoubleLoopRecord {
  return {
    id: 'double-loop-1',
    kind: 'double_loop',
    provenance: 'native',
    confidence: 'high',
    context: {
      runId: 'run-1',
      conceptId: 'concept-1',
      nodeId: 'node-1',
      nodeHash: 'node-hash',
      algorithm: 'system_self_improvement',
      phase: 'postmortem',
      nodeKind: 'consequential',
    },
    sourceLessonsArtifactRef: 'artifact-lessons',
    sourceRunId: 'run-1',
    artifactIds: ['artifact-lessons'],
    approvalState: 'pending_approval',
    legacy: false,
    quarantined: false,
    evidence: [{ artifactRef: 'artifact-lessons', verifierConfirmed: true }],
    createdAt: '1970-01-01T00:00:00.000Z',
    author: 'historian',
    proposedChangeType: 'algorithm',
    targetScope: baseTargetScope(),
    systemicDefect: 'Repeated verification omissions',
    expectedImpact: 'Improve verification pass rate',
    impact: { predictedScore: 0.8 },
    risks: ['May overfit to one failure'],
    rollbackPlan: 'Restore previous strategy rule',
    status: 'candidate',
    similarityKey: 'similarity-key',
    requiresNovelEvidenceAfterRejection: true,
    ...overrides,
  };
}

function baseTargetScope(): DoubleLoopRecord['targetScope'] {
  return {
    algorithm: 'system_self_improvement',
    phase: 'postmortem',
    nodeKind: 'consequential',
    ruleKey: 'system_self_improvement.postmortem.test_gap',
    currentRule: 'current rule',
    proposedRule: 'proposed rule',
  };
}

function suite(record: DoubleLoopRecord, runId: string): AcceptanceTestSuite {
  return {
    suiteId: `suite-${record.id}`,
    conceptId: record.context.conceptId ?? 'concept-1',
    runId,
    subjectId: record.id,
    workdir: process.cwd(),
    checks: [{
      id: 'eval',
      label: 'eval proof',
      weight: 100,
      verifyCheck: { name: 'eval', command: 'exit 0', weight: 100 },
    }],
  };
}

function acceptanceReport(verdict: AcceptanceReport['verdict']): AcceptanceReport {
  return {
    suiteId: 'suite-1',
    conceptId: 'concept-1',
    runId: 'run-meta',
    subjectId: 'double-loop-1',
    verdict,
    status: verdict === 'pass' ? 'passed' : verdict === 'block' ? 'blocked' : 'needs_rework',
    score: verdict === 'pass' ? 100 : 0,
    thresholdScore: 80,
    checkResults: [],
    artifactId: `eval-artifact-${verdict}`,
    artifactRef: {
      id: `eval-artifact-${verdict}`,
      kind: 'test_result',
      uri: `/tmp/eval-artifact-${verdict}`,
      createdAt: '1970-01-01T00:00:00.000Z',
      runId: 'run-meta',
    },
    reworkCycle: 0,
    testedAt: '1970-01-01T00:00:00.000Z',
  };
}
