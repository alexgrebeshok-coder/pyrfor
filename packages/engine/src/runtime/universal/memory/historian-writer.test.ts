import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalDecision } from '../../approval-flow';
import { EventLedger } from '../../event-ledger';
import { createMemoryStore, type MemoryStore } from '../../memory-store';
import { createUniversalMemoryFacade } from './memory-facade';
import { StrategyMemoryProvider } from './strategy-memory-provider';
import {
  persistLessons,
  promoteDoubleLoop,
  quarantineDoubleLoop,
  writeStrategyOrConflict,
  type HistorianProvenance,
} from './historian-writer';
import type { HistorianDistillInput } from '../historian';

describe('historian-writer', () => {
  let dir: string;
  let memoryStore: MemoryStore;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-historian-writer-'));
    memoryStore = createMemoryStore({ dbPath: ':memory:' });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    memoryStore.close();
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists single-loop and double-loop lessons with provenance tags', async () => {
    const result = await persistLessons(distillInput({ strategyDelta: 'prefer executable acceptance first' }), provenance(), deps('approve'));

    expect(result.singleLoopEntry?.tags).toEqual(expect.arrayContaining([
      'single_loop',
      'runId:run-1',
      'conceptId:concept-1',
      'nodeId:node-1',
      'artifactRef:artifact-lessons',
      'artifactId:artifact-lessons',
      'sourceRunId:run-1',
      'project:p1',
      'parentConceptId:parent-1',
      'retryOf:failed-1',
      'domain:coding',
      'toolSignature:vitest',
      'verifierScore:1.000',
      'acceptanceTestPassRate:1.000',
      'approvalState:approved',
      'non_legacy',
      'non_quarantined',
      'lessons_learned',
      'postmortem',
      'consequential',
      'confidence:high',
    ]));
    expect(result.doubleLoopEntry?.tags).toEqual(expect.arrayContaining([
      'double_loop',
      'candidate',
      'approvalState:pending_approval',
      'artifactRef:artifact-lessons',
    ]));
    expect(JSON.parse(result.singleLoopEntry!.text)).toMatchObject({
      sourceRunId: 'run-1',
      artifactIds: ['artifact-lessons'],
      approvalState: 'approved',
      legacy: false,
      quarantined: false,
      context: {
        projectId: 'p1',
        parentConceptId: 'parent-1',
        retryOf: 'failed-1',
        domain: 'coding',
        toolSignatures: ['vitest'],
        verifierScore: 1,
        acceptanceTestPassRate: 1,
      },
    });
    expect((await ledger.readAll()).filter((event) => event.type === 'memory.written')).toHaveLength(2);
  });

  it('makes approved high-confidence single-loop lessons retrievable', async () => {
    const result = await persistLessons(distillInput({ scope: 'run' }), provenance(), deps('approve'));
    const facade = createUniversalMemoryFacade({
      memoryStore,
      strategyProvider: new StrategyMemoryProvider({ memoryStore }),
    });

    expect(result.singleLoopEntry?.tags).toContain('approved');
    await expect(facade.prefetch({
      runId: 'run-1',
      algorithm: 'lessons_learned',
      phase: 'postmortem',
      nodeKind: 'consequential',
      limit: 10,
    })).resolves.toMatchObject({
      slices: expect.arrayContaining([expect.objectContaining({ id: result.singleLoopEntry!.id })]),
    });
  });

  it('keeps candidate double-loop lessons out of approved facade retrieval until promoted', async () => {
    const result = await persistLessons(distillInput({ strategyDelta: 'prefer smaller plans' }), provenance(), deps('approve'));
    const facade = createUniversalMemoryFacade({
      memoryStore,
      strategyProvider: new StrategyMemoryProvider({ memoryStore }),
    });

    expect(facade.queryApprovedLessons({ limit: 10 }).filter((entry) => entry.tags.includes('double_loop'))).toEqual([]);
    expect(facade.queryApprovedStrategies({ limit: 10 })).toEqual([]);

    await promoteDoubleLoop(result.doubleLoopEntry!.id, 'reviewer', { memoryStore, ledger });

    expect(facade.queryApprovedLessons({ limit: 10 }).map((entry) => entry.id)).toContain(result.doubleLoopEntry!.id);
    await expect(facade.prefetch({
      runId: 'run-1',
      algorithm: 'lessons_learned',
      phase: 'postmortem',
      nodeKind: 'consequential',
      limit: 10,
    })).resolves.toMatchObject({
      slices: expect.arrayContaining([expect.objectContaining({ id: result.doubleLoopEntry!.id })]),
    });
    expect(JSON.parse(memoryStore.get(result.doubleLoopEntry!.id)!.text)).toMatchObject({
      status: 'approved',
      approvalState: 'approved',
      quarantined: false,
    });
  });

  it('quarantines double-loop lessons and excludes them from approved retrieval', async () => {
    const result = await persistLessons(distillInput({ strategyDelta: 'change verifier policy' }), provenance(), deps('approve'));

    const quarantined = await quarantineDoubleLoop(result.doubleLoopEntry!.id, 'insufficient evidence', { memoryStore, ledger });

    expect(quarantined?.tags).toContain('quarantined');
    expect(JSON.parse(quarantined!.text)).toMatchObject({
      status: 'quarantined',
      approvalState: 'quarantined',
      quarantined: true,
      rejectionReason: 'insufficient evidence',
    });
    const facade = createUniversalMemoryFacade({
      memoryStore,
      strategyProvider: new StrategyMemoryProvider({ memoryStore }),
    });
    expect(facade.queryApprovedLessons({ limit: 10 }).filter((entry) => entry.tags.includes('double_loop'))).toEqual([]);
  });

  it('writes new strategies with provenance and emits memory.written', async () => {
    const result = await writeStrategyOrConflict({
      key: 'planning.default',
      value: 'always include executable acceptance',
      source: 'historian-distilled',
      sourceArtifactRef: 'artifact-lessons',
    }, provenance(), deps('approve'));

    expect('wrote' in result ? result.wrote.tags : []).toEqual(expect.arrayContaining([
      'strategy',
      'approved',
      'key:planning.default',
      'runId:run-1',
      'conceptId:concept-1',
      'nodeId:node-1',
      'artifactRef:artifact-lessons',
    ]));
    expect((await ledger.readAll()).map((event) => event.type)).toContain('memory.written');
  });

  it('raises approval and skips conflicting strategy write when denied', async () => {
    await writeStrategyOrConflict({
      key: 'planning.default',
      value: 'old value',
      source: 'historian-distilled',
      sourceArtifactRef: 'artifact-old',
    }, provenance(), deps('approve'));
    const approvalFlow = approval('deny');

    const conflict = await writeStrategyOrConflict({
      key: 'planning.default',
      value: 'new value',
      source: 'historian-distilled',
      sourceArtifactRef: 'artifact-new',
    }, provenance(), { memoryStore, ledger, approvalFlow });

    expect(conflict).toHaveProperty('conflictId');
    expect(approvalFlow.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'memory.write',
      reason_codes: ['conflict'],
    }));
    expect(memoryStore.query({ kind: 'strategy', tags: ['key:planning.default'], limit: 1 })[0]?.text).toBe('old value');
    expect((await ledger.readAll()).map((event) => event.type)).toContain('memory.conflict');
  });

  it('writes conflicting strategy after approval', async () => {
    await writeStrategyOrConflict({
      key: 'planning.default',
      value: 'old value',
      source: 'historian-distilled',
      sourceArtifactRef: 'artifact-old',
    }, provenance(), deps('approve'));

    const result = await writeStrategyOrConflict({
      key: 'planning.default',
      value: 'new value',
      source: 'historian-distilled',
      sourceArtifactRef: 'artifact-new',
    }, provenance(), deps('approve'));

    expect('wrote' in result ? result.wrote.text : '').toBe('new value');
    expect('wrote' in result ? result.wrote.source : '').toBe('artifact-new');
    expect((await ledger.readAll()).map((event) => event.type)).toContain('memory.conflict');
  });

  it('persists legacy double-loop lessons as quarantined', async () => {
    const result = await persistLessons(
      distillInput({ strategyDelta: 'legacy should not guide policy', nodeKind: 'legacy' }),
      provenance(),
      deps('approve'),
    );

    expect(result.doubleLoopEntry?.tags).toEqual(expect.arrayContaining(['double_loop', 'legacy', 'quarantined']));
    expect(JSON.parse(result.doubleLoopEntry!.text)).toMatchObject({
      approvalState: 'quarantined',
      legacy: true,
      quarantined: true,
    });
  });

  it('rejects promote/quarantine for non-double-loop entries', async () => {
    const result = await persistLessons(distillInput(), provenance(), deps('approve'));

    await expect(promoteDoubleLoop(result.singleLoopEntry!.id, 'reviewer', { memoryStore, ledger }))
      .rejects.toThrow(/non-double-loop/);
    await expect(quarantineDoubleLoop(result.singleLoopEntry!.id, 'bad target', { memoryStore, ledger }))
      .rejects.toThrow(/non-double-loop/);
  });

  it('rejects malformed double-loop payloads during status transitions', async () => {
    const malformed = memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify({ id: 'bad', kind: 'double_loop', status: 'candidate' }),
      source: 'test',
      scope: 'universal',
      tags: ['double_loop', 'candidate', 'runId:run-1', 'nodeId:node-1'],
      weight: 0.5,
    });

    await expect(promoteDoubleLoop(malformed.id, 'reviewer', { memoryStore, ledger }))
      .rejects.toThrow(/does not contain a double-loop record/);
  });

  it('rejects partially malformed double-loop payloads during status transitions', async () => {
    const result = await persistLessons(distillInput({ strategyDelta: 'change policy safely' }), provenance(), deps('approve'));
    const parsed = JSON.parse(result.doubleLoopEntry!.text);
    delete parsed.targetScope.currentRule;
    memoryStore.update(result.doubleLoopEntry!.id, { text: JSON.stringify(parsed) });

    await expect(promoteDoubleLoop(result.doubleLoopEntry!.id, 'reviewer', { memoryStore, ledger }))
      .rejects.toThrow(/does not contain a double-loop record/);
  });

  it('rejects double-loop payloads without provenance or impact signals', async () => {
    const result = await persistLessons(distillInput({ strategyDelta: 'change policy safely' }), provenance(), deps('approve'));
    const parsed = JSON.parse(result.doubleLoopEntry!.text);
    delete parsed.provenance;
    parsed.impact = {};
    memoryStore.update(result.doubleLoopEntry!.id, { text: JSON.stringify(parsed) });

    await expect(promoteDoubleLoop(result.doubleLoopEntry!.id, 'reviewer', { memoryStore, ledger }))
      .rejects.toThrow(/does not contain a double-loop record/);
  });

  function deps(decision: ApprovalDecision) {
    return { memoryStore, ledger, approvalFlow: approval(decision) };
  }
});

function approval(decision: ApprovalDecision) {
  return {
    requestApproval: vi.fn(async () => decision),
  };
}

function provenance(): HistorianProvenance {
  return {
    runId: 'run-1',
    conceptId: 'concept-1',
    projectId: 'p1',
    parentConceptId: 'parent-1',
    retryOf: 'failed-1',
    nodeId: 'node-1',
    artifactRefs: ['artifact-lessons'],
    algorithm: 'lessons_learned',
  };
}

function distillInput(overrides: {
  strategyDelta?: string;
  nodeKind?: 'consequential' | 'legacy';
  scope?: 'tool' | 'run' | 'policy' | 'strategy';
} = {}): HistorianDistillInput {
  return {
    sourceLessonsArtifactRef: 'artifact-lessons',
    context: {
      runId: 'run-1',
      conceptId: 'concept-1',
      projectId: 'p1',
      parentConceptId: 'parent-1',
      retryOf: 'failed-1',
      nodeId: 'node-1',
      nodeHash: 'node-hash',
      algorithm: 'lessons_learned',
      phase: 'postmortem',
      nodeKind: overrides.nodeKind ?? 'consequential',
      domain: 'coding',
      toolSignatures: ['vitest'],
      verifierScore: 1,
      acceptanceTestPassRate: 1,
    },
    lessons: {
      scope: overrides.scope ?? 'strategy',
      whatWorked: ['acceptance tests caught the issue'],
      whatFailed: ['planner omitted executable tests'],
      rootCause: 'test_gap',
      strategyDelta: overrides.strategyDelta,
      evidenceRefs: ['artifact-lessons'],
      confidence: 'high',
      algorithmOutcome: 'success',
    },
  };
}
