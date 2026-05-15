import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { createExperienceLibrary } from './experience-library';

describe('ExperienceLibrary', () => {
  let dir: string;
  let memoryStore: MemoryStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-experience-library-'));
    memoryStore = createMemoryStore({ dbPath: ':memory:' });
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
  });

  afterEach(() => {
    memoryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('projects approved project-scoped lessons into planner-safe experience entries', async () => {
    const artifact = await artifactStore.writeJSON('postmortem_report', {
      outcome: 'completed',
      whatWorked: ['postmortem pattern'],
      whatFailed: [],
      reusablePatterns: ['postmortem reusable pattern'],
      toolsUsed: ['vitest'],
      toolsForged: [],
    }, { runId: 'run-1' });
    const lesson = memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify({
        kind: 'single_loop',
        sourceRunId: 'run-1',
        artifactIds: [artifact.id],
        approvalState: 'approved',
        legacy: false,
        quarantined: false,
        context: {
          runId: 'run-1',
          conceptId: 'concept-1',
          projectId: 'p1',
          parentConceptId: 'parent-1',
          retryOf: 'retry-1',
          domain: 'coding',
          toolSignatures: ['vitest'],
          verifierScore: 1,
          acceptanceTestPassRate: 1,
        },
        fixApplied: 'run targeted vitest before full suite',
        reusablePattern: 'targeted-test-first',
        algorithmOutcome: 'improved',
        createdAt: '2026-05-15T00:00:00.000Z',
      }),
      source: 'historian:run-1',
      scope: 'universal',
      tags: [
        'single_loop',
        'approved',
        'approvalState:approved',
        'non_legacy',
        'non_quarantined',
        'runId:run-1',
        'sourceRunId:run-1',
        'conceptId:concept-1',
        'project:p1',
        'parentConceptId:parent-1',
        'retryOf:retry-1',
        'domain:coding',
        'toolSignature:vitest',
        'verifierScore:1.000',
        'acceptanceTestPassRate:1.000',
        `artifactId:${artifact.id}`,
      ],
      weight: 0.9,
    });
    const library = createExperienceLibrary({ memoryStore, artifactStore, now: () => new Date('2026-05-15T01:00:00.000Z') });

    const results = await library.findSimilar({ goal: 'vitest targeted test', projectId: 'p1', limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: `experience:${lesson.id}`,
      runId: 'run-1',
      conceptId: 'concept-1',
      projectId: 'p1',
      approvalState: 'approved',
      legacy: false,
      quarantined: false,
      domain: 'coding',
      outcome: 'completed',
      whatWorked: ['postmortem pattern'],
      reusablePatterns: ['postmortem reusable pattern', 'targeted-test-first', 'run targeted vitest before full suite'],
      verifierScore: 1,
      acceptanceTestPassRate: 1,
      provenance: {
        sourceRunId: 'run-1',
        conceptId: 'concept-1',
        parentConceptId: 'parent-1',
        retryOf: 'retry-1',
        memoryEntryIds: [lesson.id],
        artifactIds: [artifact.id],
      },
    });
    expect(results[0]?.sourceArtifacts.map((ref) => ref.id)).toEqual([artifact.id]);
  });

  it('planner query excludes quarantined, rejected, legacy, and cross-project entries', async () => {
    addTaggedLesson('approved p1', ['approved', 'approvalState:approved', 'project:p1', 'non_legacy', 'non_quarantined']);
    addTaggedLesson('legacy p1', ['approved', 'approvalState:approved', 'project:p1', 'legacy']);
    addTaggedLesson('quarantined p1', ['approved', 'approvalState:quarantined', 'project:p1', 'quarantined']);
    addTaggedLesson('rejected p1', ['rejected', 'approvalState:rejected', 'project:p1']);
    addTaggedLesson('approved p2', ['approved', 'approvalState:approved', 'project:p2', 'non_legacy', 'non_quarantined']);
    const library = createExperienceLibrary({ memoryStore });

    const results = await library.queryForPlanner({ projectId: 'p1', limit: 10 });

    expect(results.map((entry) => entry.sourceMemory.text)).toEqual(['approved p1']);
  });

  it('reports pattern effectiveness and top patterns from approved entries', async () => {
    addTaggedLesson('use dry-run before apply', ['approved', 'approvalState:approved', 'project:p1', 'domain:coding', 'verifierScore:0.800']);
    addTaggedLesson('use dry-run before apply', ['approved', 'approvalState:approved', 'project:p2', 'domain:coding', 'verifierScore:1.000']);
    const library = createExperienceLibrary({ memoryStore });

    await expect(library.getPatternEffectiveness('use dry-run before apply')).resolves.toBe(0.9);
    await expect(library.getTopPatterns('coding', 1)).resolves.toMatchObject([{
      patternKey: 'use dry-run before apply',
      occurrences: 2,
      averageEffectiveness: 0.9,
    }]);
  });

  function addTaggedLesson(text: string, tags: string[]): void {
    memoryStore.add({
      kind: 'lesson',
      text,
      source: 'test',
      scope: 'universal',
      tags,
      weight: 0.5,
    });
  }
});
