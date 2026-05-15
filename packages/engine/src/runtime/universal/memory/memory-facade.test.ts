import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import { BlockRegistry } from '../../block-registry';
import type { BlockManifest } from '../../block-manifest';
import { resolveBlockMemoryScopes } from '../../block-memory-namespace';
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
    memoryStore.add({
      kind: 'lesson',
      text: 'approval-state quarantined lesson must not be injected',
      source: 'lesson:quarantined',
      scope: 'project:p1',
      tags: ['approved', 'approvalState:quarantined', 'strategy', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'lesson',
      text: 'imported quarantined lesson must not be injected',
      source: 'lesson:imported',
      scope: 'project:p1',
      tags: ['approved', 'imported_quarantined', 'strategy', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'lesson',
      text: 'other project approved lesson must not be injected',
      source: 'lesson:other-project',
      scope: 'project:p2',
      tags: ['approved', 'strategy', 'project:p2'],
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

  it('prefetches approved memories from active block project_shared scopes only', async () => {
    const memoryStore = createMemoryStore({ dbPath: ':memory:' });
    const activeManifest = manifest('com.example.active', true);
    const inactiveManifest = manifest('com.example.inactive', true);
    const noReadManifest = manifest('com.example.no-read', false);
    const blockRegistry = new BlockRegistry();
    blockRegistry.register({
      blockId: activeManifest.id,
      projectId: 'p1',
      manifest: activeManifest,
      status: 'active',
      registeredAt: '2026-05-15T00:00:00.000Z',
      memoryScopeMap: resolveBlockMemoryScopes(activeManifest, 'p1'),
    });
    blockRegistry.register({
      blockId: inactiveManifest.id,
      projectId: 'p1',
      manifest: inactiveManifest,
      status: 'inactive',
      registeredAt: '2026-05-15T00:00:00.000Z',
      memoryScopeMap: resolveBlockMemoryScopes(inactiveManifest, 'p1'),
    });
    blockRegistry.register({
      blockId: noReadManifest.id,
      projectId: 'p1',
      manifest: noReadManifest,
      status: 'active',
      registeredAt: '2026-05-15T00:00:00.000Z',
      memoryScopeMap: resolveBlockMemoryScopes(noReadManifest, 'p1'),
    });
    memoryStore.add({
      kind: 'fact',
      text: 'active block shared memory',
      source: 'block:active',
      scope: 'prj:p1:shared:estimate_items',
      tags: ['approved', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'fact',
      text: 'inactive block shared memory',
      source: 'block:inactive',
      scope: 'prj:p1:shared:inactive_items',
      tags: ['approved', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'fact',
      text: 'quarantined active block memory',
      source: 'block:active',
      scope: 'prj:p1:shared:estimate_items',
      tags: ['approved', 'quarantined', 'project:p1'],
      weight: 1,
    });
    memoryStore.add({
      kind: 'fact',
      text: 'block without read capability memory',
      source: 'block:no-read',
      scope: 'prj:p1:shared:no_read_items',
      tags: ['approved', 'project:p1'],
      weight: 1,
    });

    const strategyProvider = new StrategyMemoryProvider({ memoryStore });
    const facade = createUniversalMemoryFacade({ memoryStore, strategyProvider, blockRegistry });
    const result = await facade.prefetch({
      runId: 'run-1',
      projectId: 'p1',
      limit: 10,
    });

    expect(result.slices.map((slice) => [slice.providerId, slice.content])).toContainEqual([
      'block-project-shared',
      'active block shared memory',
    ]);
    expect(result.slices.map((slice) => slice.content)).not.toContain('inactive block shared memory');
    expect(result.slices.map((slice) => slice.content)).not.toContain('quarantined active block memory');
    expect(result.slices.map((slice) => slice.content)).not.toContain('block without read capability memory');
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

function manifest(blockId: string, canReadProjectMemory: boolean): BlockManifest {
  const tableName = blockId.endsWith('inactive') ? 'inactive_items' : blockId.endsWith('no-read') ? 'no_read_items' : 'estimate_items';
  return {
    pyrfor_manifest_version: '1',
    id: blockId,
    name: 'Memory Block',
    version: '0.1.0',
    description: 'Memory block.',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: { main: 'dist/index.js' },
    scripts: { test: 'vitest run' },
    capabilities: canReadProjectMemory
      ? [{ token: 'memory:read', reason: 'Read project memory', scope: 'project' }]
      : [{ token: 'memory:write', reason: 'Write project memory', scope: 'project' }],
    contracts: { consumes: [], produces: [{ ref: 'ApprovalEvidence@1' }] },
    memory_scope: { project_shared: [tableName] },
    optimizer_policy: {
      editable: true,
      never_editable: ['id', 'version', 'capabilities', 'security', 'signing'],
      requires_human_approval: ['runtime', 'entrypoints', 'scripts'],
    },
    security: {
      sandbox: 'process-isolated',
      allow_fs_read: [],
      allow_fs_write: [],
      allow_network: false,
      allow_child_process: false,
      secrets_access: [],
      max_memory_mb: 256,
      max_cpu_pct: 30,
    },
    certification: { state: 'dev' },
  };
}
