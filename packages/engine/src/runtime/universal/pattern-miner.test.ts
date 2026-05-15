import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { createExperienceLibrary } from './experience-library';
import { PatternMiner, PatternMinerValidationError, splitExperienceHoldout } from './pattern-miner';
import type { DoubleLoopRecord } from './memory/types';
import type { ImprovementProposal } from './meta-critic';

describe('PatternMiner', () => {
  let dir: string;
  let memoryStore: MemoryStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-pattern-miner-'));
    memoryStore = createMemoryStore({ dbPath: ':memory:' });
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
  });

  afterEach(() => {
    memoryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('splits the newest experience into the time-based holdout set', () => {
    const entries = [
      experience('old', '2026-05-01T00:00:00.000Z'),
      experience('middle', '2026-05-02T00:00:00.000Z'),
      experience('new', '2026-05-03T00:00:00.000Z'),
    ];

    const split = splitExperienceHoldout(entries, 0.34);

    expect(split.training.map((entry) => entry.id)).toEqual(['old']);
    expect(split.holdout.map((entry) => entry.id)).toEqual(['middle', 'new']);
  });

  it('mines success patterns into pending governance proposals without auto-applying them', async () => {
    await addLesson('run-1', '2026-05-01T00:00:00.000Z', 'targeted-test-first');
    await addLesson('run-2', '2026-05-02T00:00:00.000Z', 'targeted-test-first');
    await addLesson('run-3', '2026-05-03T00:00:00.000Z', 'targeted-test-first');
    const miner = new PatternMiner({
      experienceLibrary: createExperienceLibrary({ memoryStore, artifactStore }),
      memoryStore,
      artifactStore,
      clock: () => Date.parse('2026-05-04T00:00:00.000Z'),
    });

    const result = await miner.run({
      runId: 'run-miner',
      conceptId: 'concept-miner',
      conceptKind: 'meta.improvement',
      projectId: 'p1',
      minTrainingSupport: 2,
      minHoldoutSupport: 1,
      holdoutRatio: 0.2,
    });

    expect(result).toMatchObject({
      scanned: 3,
      trainingCount: 2,
      holdoutCount: 1,
      budgetBlocked: false,
    });
    expect(result.candidates).toEqual([expect.objectContaining({
      patternKey: 'targeted-test-first',
      support: 2,
      holdoutSupport: 1,
    })]);
    expect(result.candidateEntryIds).toHaveLength(1);
    expect(result.proposalArtifactIds).toHaveLength(1);
    const candidateEntry = memoryStore.get(result.candidateEntryIds[0]!);
    expect(candidateEntry?.tags).toEqual(expect.arrayContaining([
      'double_loop',
      'candidate',
      'pattern_miner',
      'approvalState:pending_approval',
      'project:p1',
    ]));
    const record = JSON.parse(candidateEntry!.text) as DoubleLoopRecord;
    expect(record).toMatchObject({
      kind: 'double_loop',
      proposedChangeType: 'heuristic',
      status: 'candidate',
      approvalState: 'pending_approval',
      legacy: false,
      quarantined: false,
      targetScope: {
        algorithm: 'strategic_planning',
        phase: 'plan',
      },
    });
    const proposalRef = (await artifactStore.list({ runId: 'run-miner', kind: 'improvement_proposal' }))[0]!;
    const proposal = await artifactStore.readJSON<ImprovementProposal>(proposalRef);
    expect(proposal).toMatchObject({
      entryId: candidateEntry!.id,
      decision: 'pending',
      decisionReason: 'pattern_miner_candidate_requires_meta_critic',
    });
    expect(proposal.record.status).toBe('candidate');
  });

  it('does not mine quarantined or cross-project experience', async () => {
    await addLesson('run-1', '2026-05-01T00:00:00.000Z', 'safe-pattern');
    await addLesson('run-2', '2026-05-02T00:00:00.000Z', 'safe-pattern');
    await addLesson('run-3', '2026-05-03T00:00:00.000Z', 'safe-pattern', { projectId: 'p2' });
    await addLesson('run-4', '2026-05-04T00:00:00.000Z', 'safe-pattern', { approvalState: 'quarantined', quarantined: true });
    const miner = new PatternMiner({
      experienceLibrary: createExperienceLibrary({ memoryStore, artifactStore }),
      memoryStore,
      artifactStore,
    });

    const result = await miner.run({
      runId: 'run-miner',
      conceptId: 'concept-miner',
      conceptKind: 'meta.improvement',
      projectId: 'p1',
      minTrainingSupport: 2,
      minHoldoutSupport: 1,
      holdoutRatio: 0.5,
    });

    expect(result.scanned).toBe(2);
    expect(result.candidates).toHaveLength(0);
  });

  it('requires an explicit meta.improvement concept invocation', async () => {
    const miner = new PatternMiner({
      experienceLibrary: createExperienceLibrary({ memoryStore, artifactStore }),
      memoryStore,
      artifactStore,
    });

    await expect(miner.run({
      runId: 'run-miner',
      conceptId: 'concept-miner',
      conceptKind: 'regular',
      projectId: 'p1',
    } as unknown as Parameters<PatternMiner['run']>[0]))
      .rejects.toBeInstanceOf(PatternMinerValidationError);
  });

  async function addLesson(
    runId: string,
    createdAt: string,
    reusablePattern: string,
    overrides: { projectId?: string; approvalState?: 'approved' | 'quarantined'; quarantined?: boolean } = {},
  ): Promise<void> {
    const projectId = overrides.projectId ?? 'p1';
    const approvalState = overrides.approvalState ?? 'approved';
    const quarantined = overrides.quarantined ?? false;
    const artifact = await artifactStore.writeJSON('postmortem_report', {
      outcome: 'completed',
      whatWorked: [`worked ${reusablePattern}`],
      whatFailed: [],
      reusablePatterns: [reusablePattern],
      toolsUsed: ['vitest'],
      toolsForged: [],
    }, { runId });
    memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify({
        kind: 'single_loop',
        sourceRunId: runId,
        artifactIds: [artifact.id],
        approvalState,
        legacy: false,
        quarantined,
        context: {
          runId,
          conceptId: `concept-${runId}`,
          projectId,
          domain: 'coding',
          toolSignatures: ['vitest'],
          verifierScore: 1,
          acceptanceTestPassRate: 1,
        },
        reusablePattern,
        algorithmOutcome: 'improved',
        createdAt,
      }),
      source: `historian:${runId}`,
      scope: 'universal',
      tags: [
        'single_loop',
        approvalState === 'approved' ? 'approved' : 'quarantined',
        `approvalState:${approvalState}`,
        'non_legacy',
        quarantined ? 'quarantined' : 'non_quarantined',
        `project:${projectId}`,
        `runId:${runId}`,
        `sourceRunId:${runId}`,
        'domain:coding',
        'toolSignature:vitest',
        'verifierScore:1.000',
        'acceptanceTestPassRate:1.000',
        `artifactId:${artifact.id}`,
      ],
      weight: 0.9,
    });
  }
});

function experience(id: string, createdAt: string) {
  return {
    id,
    runId: id,
    projectId: 'p1',
    schemaVersion: 'pyrfor.experience.v1',
    approvalState: 'approved',
    legacy: false,
    quarantined: false,
    provenance: { sourceRunId: id, memoryEntryIds: [], artifactIds: [] },
    retrievalKey: { fts: id, goalKeywords: [], toolSignatures: [] },
    outcome: 'completed',
    whatWorked: [],
    whatFailed: [],
    reusablePatterns: [],
    wasPatternApplied: false,
    createdAt,
    indexedAt: createdAt,
    sourceMemory: {
      id,
      kind: 'lesson',
      text: id,
      source: 'test',
      scope: 'universal',
      tags: [],
      weight: 0,
      applied_count: 0,
      created_at: createdAt,
      updated_at: createdAt,
    },
    sourceArtifacts: [],
  } as const;
}
