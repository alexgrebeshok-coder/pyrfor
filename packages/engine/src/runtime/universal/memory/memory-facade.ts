import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import { hasMemoryCapabilityForTier } from '../../block-memory-namespace';
import type { BlockRegistry } from '../../block-registry';
import type { MemoryPrefetchRequest, MemoryPrefetchResult, MemorySlice } from './types';
import type { StrategyMemoryProvider } from './strategy-memory-provider';

export interface UniversalMemoryFacadeOptions {
  memoryStore: MemoryStore;
  strategyProvider: StrategyMemoryProvider;
  lessonsStore?: LessonsStore;
  blockRegistry?: BlockRegistry;
}

export interface UniversalMemoryFacade {
  prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult>;
  queryApprovedLessons(request: { projectId?: string; limit: number }): MemoryEntry[];
  queryApprovedStrategies(request: { projectId?: string; limit: number }): MemoryEntry[];
}

export function createUniversalMemoryFacade(options: UniversalMemoryFacadeOptions): UniversalMemoryFacade {
  async function prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult> {
    const strategy = await options.strategyProvider.prefetch(request);
    const approvedLessons = queryApprovedLessons({
      projectId: request.projectId,
      limit: request.limit,
    }).map((entry) => entryToSlice(entry));
    const approvedStrategies = queryApprovedStrategies({
      projectId: request.projectId,
      limit: request.limit,
    }).map((entry) => entryToSlice(entry));
    const blockProjectShared = queryBlockProjectSharedSlices({
      projectId: request.projectId,
      limit: request.limit,
    });
    const slices = dedupeSlices([...strategy.slices, ...approvedStrategies, ...approvedLessons, ...blockProjectShared])
      .sort((a, b) => b.priority - a.priority)
      .slice(0, request.limit);
    return { ...strategy, slices };
  }

  function queryApprovedLessons(request: { projectId?: string; limit: number }): MemoryEntry[] {
    const tags = ['approved'];
    if (request.projectId) tags.push(`project:${request.projectId}`);
    return options.memoryStore.query({
      kind: 'lesson',
      tags,
      limit: request.limit,
    }).filter((entry) =>
      isPlannerVisibleApprovedMemory(entry.tags, request.projectId)
    );
  }

  function queryBlockProjectSharedSlices(request: { projectId?: string; limit: number }): MemorySlice[] {
    if (!options.blockRegistry || !request.projectId) return [];
    const slices: MemorySlice[] = [];
    for (const entry of options.blockRegistry.list({ status: 'active' })) {
      if (!entry.memoryScopeMap || !hasMemoryCapabilityForTier(entry.manifest, 'project_shared', 'read')) continue;
      for (const namespace of entry.memoryScopeMap.values()) {
        if (namespace.tier !== 'project_shared') continue;
        const memories = options.memoryStore.query({
          scope: namespace.scope,
          limit: request.limit,
        }).filter((memory) =>
          isPlannerVisibleApprovedMemory(memory.tags, request.projectId)
        );
        for (const memory of memories) {
          slices.push(entryToSlice(memory, 'block-project-shared'));
        }
      }
    }
    return slices;
  }

  function queryApprovedStrategies(request: { projectId?: string; limit: number }): MemoryEntry[] {
    const tags = ['strategy', 'approved'];
    if (request.projectId) tags.push(`project:${request.projectId}`);
    return options.memoryStore.query({
      kind: 'strategy',
      tags,
      limit: request.limit,
    }).filter((entry) =>
      isPlannerVisibleApprovedMemory(entry.tags, request.projectId)
    );
  }

  return { prefetch, queryApprovedLessons, queryApprovedStrategies };
}

function isPlannerVisibleApprovedMemory(tags: string[], projectId?: string): boolean {
  if (!tags.includes('approved')) return false;
  if (tags.some((tag) => tag === 'legacy' || tag === 'rejected' || tag === 'quarantined' || tag === 'imported_quarantined')) {
    return false;
  }
  if (tags.includes('approvalState:rejected') || tags.includes('approvalState:quarantined')) {
    return false;
  }
  return projectId === undefined || tags.includes(`project:${projectId}`);
}

function entryToSlice(entry: MemoryEntry, providerId = 'memory-facade'): MemorySlice {
  return {
    id: entry.id,
    providerId,
    priority: 75 + entry.weight,
    content: entry.text,
    sourceRefs: [entry.source],
  };
}

function dedupeSlices(slices: MemorySlice[]): MemorySlice[] {
  const seen = new Set<string>();
  const result: MemorySlice[] = [];
  for (const slice of slices) {
    const key = slice.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slice);
  }
  return result;
}
