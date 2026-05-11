import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../memory-store';
import { StrategyMemoryProvider } from './strategy-memory-provider';
import { createStrategyStore } from './strategy-store';

describe('StrategyStore', () => {
  it('sets and gets an approved global strategy', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const strategyStore = createStrategyStore(memoryStore);

    const stored = strategyStore.setApproved({
      key: 'small-prs',
      value: 'Prefer short PRs for risky refactors',
      source: 'user',
      impactScore: 0.9,
      governedByAlgorithm: 'strategic_planning',
    });
    const loaded = strategyStore.getApproved('small-prs');

    expect(loaded?.memoryEntryId).toBe(stored.memoryEntryId);
    expect(loaded?.value).toBe('Prefer short PRs for risky refactors');
    expect(loaded?.approval).toBe('approved');
    expect(loaded?.governedByAlgorithm).toBe('strategic_planning');
    memoryStore.close();
  });

  it('upserts by key and project without duplicating rows', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const strategyStore = createStrategyStore(memoryStore);

    strategyStore.setApproved({
      key: 'runner',
      value: 'Use local runner first',
      projectId: 'p1',
      source: 'user',
    });
    strategyStore.setApproved({
      key: 'runner',
      value: 'Use wasm runner first',
      projectId: 'p1',
      source: 'user',
    });

    expect(strategyStore.getApproved('runner', { projectId: 'p1' })?.value).toBe('Use wasm runner first');
    expect(strategyStore.listApproved({ projectId: 'p1' })).toHaveLength(1);
    memoryStore.close();
  });

  it('keeps project strategies isolated unless global inclusion is requested', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const strategyStore = createStrategyStore(memoryStore);

    strategyStore.setApproved({ key: 'tone', value: 'global tone', source: 'user' });
    strategyStore.setApproved({ key: 'tone', value: 'project p1 tone', projectId: 'p1', source: 'user' });
    strategyStore.setApproved({ key: 'tone', value: 'project p2 tone', projectId: 'p2', source: 'user' });

    expect(strategyStore.listApproved({ projectId: 'p1' }).map((entry) => entry.value)).toEqual(['project p1 tone']);
    expect(strategyStore.listApproved({ projectId: 'p1', includeGlobal: true }).map((entry) => entry.value).sort())
      .toEqual(['global tone', 'project p1 tone']);
    expect(strategyStore.getApproved('tone', { projectId: 'p1' })?.value).toBe('project p1 tone');
    expect(strategyStore.getApproved('tone', { projectId: 'p3' })).toBeUndefined();
    memoryStore.close();
  });

  it('does not return legacy, rejected, or quarantined strategy entries', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    memoryStore.add({
      kind: 'strategy',
      text: 'approved strategy',
      source: 'manual',
      scope: 'strategy',
      tags: ['strategy', 'approved', 'key:safe'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'strategy',
      text: 'legacy strategy',
      source: 'manual',
      scope: 'strategy',
      tags: ['strategy', 'approved', 'legacy', 'key:legacy'],
      weight: 1,
    });

    const strategyStore = createStrategyStore(memoryStore);
    expect(strategyStore.listApproved().map((entry) => entry.value)).toEqual(['approved strategy']);
    memoryStore.close();
  });

  it('feeds StrategyMemoryProvider through approved strategy memory', async () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const strategyStore = createStrategyStore(memoryStore);
    strategyStore.setApproved({
      key: 'risk',
      value: 'Ask for evidence before risky changes',
      projectId: 'p1',
      source: 'user',
    });

    const provider = new StrategyMemoryProvider({ memoryStore });
    const result = await provider.prefetch({
      runId: 'run-1',
      projectId: 'p1',
      limit: 10,
    });

    expect(result.slices.map((slice) => slice.content)).toEqual(['Ask for evidence before risky changes']);
    memoryStore.close();
  });
});
