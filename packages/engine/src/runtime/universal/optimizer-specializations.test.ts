import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import type { ImprovementProposal } from './meta-critic';
import type { DoubleLoopRecord } from './memory/types';
import {
  OptimizerSpecializationError,
  OptimizerSpecializationRunner,
  assertOptimizerTargetEditable,
} from './optimizer-specializations';

describe('OptimizerSpecializationRunner', () => {
  let dir: string;
  let artifactStore: ArtifactStore;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-optimizer-specializations-'));
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    memoryStore = createMemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    memoryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates pending optimizer proposals as meta.improvement candidates only', async () => {
    const evidence = await artifactStore.writeJSON('test_result', { verdict: 'pass' }, { runId: 'run-opt' });
    const runner = new OptimizerSpecializationRunner({
      artifactStore,
      memoryStore,
      clock: () => Date.parse('2026-05-15T00:00:00.000Z'),
    });

    const result = await runner.propose({
      runId: 'run-opt',
      conceptId: 'concept-opt',
      conceptKind: 'meta.improvement',
      projectId: 'p1',
      specialization: 'prompt_engineer',
      algorithm: 'prompt_optimization',
      targetKey: 'planner.prompt.strategy-hints',
      currentBehavior: 'Planner receives unstructured strategy hints.',
      proposedBehavior: 'Planner receives compact pattern/antipattern hints with provenance IDs.',
      rationale: 'Repeated plans perform better with compact provenance-bearing hints.',
      rollbackPlan: 'Remove the prompt hint rule and use the previous planner prompt template.',
      evidenceArtifactIds: [evidence.id],
      domain: 'coding',
      toolSignatures: ['vitest'],
    });

    const entry = memoryStore.get(result.entryId);
    expect(entry?.tags).toEqual(expect.arrayContaining([
      'double_loop',
      'candidate',
      'optimizer',
      'optimizer:prompt_engineer',
      'optimizerAlgorithm:prompt_optimization',
      'approvalState:pending_approval',
      'project:p1',
    ]));
    const record = JSON.parse(entry!.text) as DoubleLoopRecord;
    expect(record).toMatchObject({
      kind: 'double_loop',
      proposedChangeType: 'heuristic',
      status: 'candidate',
      approvalState: 'pending_approval',
      author: 'agent:prompt_engineer',
      targetScope: {
        phase: 'self_improvement',
        nodeKind: 'consequential',
      },
    });
    expect(record.artifactIds).toEqual(expect.arrayContaining([result.reportRef.id, evidence.id]));
    const proposal = await artifactStore.readJSON<ImprovementProposal>(result.proposalRef);
    expect(proposal).toMatchObject({
      entryId: result.entryId,
      decision: 'pending',
      decisionReason: 'optimizer_candidate_requires_meta_critic',
    });
  });

  it('blocks optimizer edits to never-editable governance surfaces', () => {
    expect(() => assertOptimizerTargetEditable('runtime.verifier_rules.thresholds'))
      .toThrow(/protected target: verifier_rules/);
    expect(() => assertOptimizerTargetEditable('effect-gateway.allowlist.github'))
      .toThrow(/protected target: effect_gateway_allowlists/);
    expect(() => assertOptimizerTargetEditable('planner.prompt.strategy-hints')).not.toThrow();
  });

  it('rejects optimizer runs that are not explicit meta.improvement concepts', async () => {
    const evidence = await artifactStore.writeJSON('test_result', { verdict: 'pass' }, { runId: 'run-opt' });
    const runner = new OptimizerSpecializationRunner({ artifactStore, memoryStore });

    await expect(runner.propose({
      runId: 'run-opt',
      conceptId: 'concept-opt',
      conceptKind: 'regular',
      projectId: 'p1',
      specialization: 'strategy_planner',
      algorithm: 'failure_correction',
      targetKey: 'strategy.memory.retrieval',
      currentBehavior: 'current',
      proposedBehavior: 'proposed',
      rationale: 'rationale',
      rollbackPlan: 'rollback',
      evidenceArtifactIds: [evidence.id],
    } as Parameters<OptimizerSpecializationRunner['propose']>[0]))
      .rejects.toBeInstanceOf(OptimizerSpecializationError);
  });
});
