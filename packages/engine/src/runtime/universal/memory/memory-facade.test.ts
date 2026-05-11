import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import { StrategyMemoryProvider } from './strategy-memory-provider';
import { createUniversalMemoryFacade } from './memory-facade';

describe('UniversalMemoryFacade', () => {
  it('returns only approved non-legacy lessons by default', () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    memoryStore.add({
      kind: 'lesson',
      text: 'approved strategic lesson',
      source: 'lesson:approved',
      scope: 'project:p1',
      tags: ['approved', 'strategy', 'project:p1'],
      weight: 0.9,
    });
    memoryStore.add({
      kind: 'lesson',
      text: 'legacy lesson must not be injected',
      source: 'lesson:legacy',
      scope: 'project:p1',
      tags: ['approved', 'legacy', 'strategy', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'lesson',
      text: 'rejected lesson must not be injected',
      source: 'lesson:rejected',
      scope: 'project:p1',
      tags: ['rejected', 'strategy', 'project:p1'],
      weight: 1,
    });

    const strategyProvider = new StrategyMemoryProvider({ memoryStore });
    const facade = createUniversalMemoryFacade({ memoryStore, strategyProvider });
    const lessons = facade.queryApprovedLessons({ projectId: 'p1', limit: 10 });

    expect(lessons.map((entry) => entry.text)).toEqual(['approved strategic lesson']);
    memoryStore.close();
  });

  it('deduplicates strategy provider and facade slices during prefetch', async () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    memoryStore.add({
      kind: 'lesson',
      text: 'approved strategic lesson',
      source: 'lesson:approved',
      scope: 'project:p1',
      tags: ['approved', 'strategy', 'project:p1'],
      weight: 0.9,
    });

    const strategyProvider = new StrategyMemoryProvider({ memoryStore });
    const facade = createUniversalMemoryFacade({ memoryStore, strategyProvider });
    const result = await facade.prefetch({
      runId: 'run-1',
      projectId: 'p1',
      algorithm: 'strategic_planning',
      limit: 10,
    });

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]?.providerId).toBe('strategy');
    memoryStore.close();
  });

  it('returns approved project-scoped strategies during prefetch', async () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    memoryStore.add({
      kind: 'strategy',
      text: 'approved project strategy',
      source: 'strategy:user',
      scope: 'strategy',
      tags: ['strategy', 'approved', 'project:p1', 'key:planning'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'strategy',
      text: 'quarantined project strategy',
      source: 'strategy:user',
      scope: 'strategy',
      tags: ['strategy', 'approved', 'quarantined', 'project:p1', 'key:bad'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'strategy',
      text: 'other project strategy',
      source: 'strategy:user',
      scope: 'strategy',
      tags: ['strategy', 'approved', 'project:p2', 'key:planning'],
      weight: 1,
    });

    const strategyProvider = new StrategyMemoryProvider({ memoryStore });
    const facade = createUniversalMemoryFacade({ memoryStore, strategyProvider });
    const result = await facade.prefetch({
      runId: 'run-1',
      projectId: 'p1',
      limit: 10,
    });

    expect(result.slices.map((slice) => slice.content)).toEqual(['approved project strategy']);
    memoryStore.close();
  });

  it('filters markdown lessons store with approved double-loop AND semantics', async () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const lessonsStore: Pick<LessonsStore, 'topN'> = {
      topN() {
        return [
          {
            id: 'approved',
            iteration: 1,
            text: 'approved double-loop lesson',
            tags: ['double_loop', 'approved', 'project:p1'],
            weight: 0.8,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'double-only',
            iteration: 1,
            text: 'double-loop without approval',
            tags: ['double_loop', 'project:p1'],
            weight: 1,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'legacy-approved',
            iteration: 1,
            text: 'legacy approved lesson',
            tags: ['double_loop', 'approved', 'legacy', 'project:p1'],
            weight: 1,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'other-project',
            iteration: 1,
            text: 'approved other project lesson',
            tags: ['double_loop', 'approved', 'project:p2'],
            weight: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      },
    };

    const strategyProvider = new StrategyMemoryProvider({
      memoryStore,
      lessonsStore: lessonsStore as LessonsStore,
    });
    const result = await strategyProvider.prefetch({
      runId: 'run-1',
      projectId: 'p1',
      limit: 10,
    });

    expect(result.slices.map((slice) => slice.id)).toEqual(['approved']);
    memoryStore.close();
  });
});
