import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import type { MemoryPrefetchRequest, MemoryPrefetchResult, MemorySlice } from './types';
import type { StrategyMemoryProvider } from './strategy-memory-provider';

export interface UniversalMemoryFacadeOptions {
  memoryStore: MemoryStore;
  strategyProvider: StrategyMemoryProvider;
  lessonsStore?: LessonsStore;
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
    }).map(entryToSlice);
    const approvedStrategies = queryApprovedStrategies({
      projectId: request.projectId,
      limit: request.limit,
    }).map(entryToSlice);
    const slices = dedupeSlices([...strategy.slices, ...approvedStrategies, ...approvedLessons])
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

function entryToSlice(entry: MemoryEntry): MemorySlice {
  return {
    id: entry.id,
    providerId: 'memory-facade',
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
