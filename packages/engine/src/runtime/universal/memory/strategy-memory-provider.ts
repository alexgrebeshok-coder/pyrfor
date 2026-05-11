import type { MemoryEntry, MemoryQuery, MemoryStore } from '../../memory-store';
import type { LessonEntry, LessonsStore } from '../../ralph-lessons-store';
import {
  createAlgorithmAwareRetriever,
  type AlgorithmAwareRetriever,
} from './algorithm-aware-retriever';
import type {
  MemoryPrefetchRequest,
  MemoryPrefetchResult,
  MemorySlice,
  MemoryTurnSync,
  MemoryWriteResult,
} from './types';
import type {
  CompressionReport,
  CompressionScope,
  MemoryProvider,
  MemoryProviderContext,
  MemoryStrategy,
} from './provider';

export interface StrategyMemoryProviderOptions {
  memoryStore: MemoryStore;
  lessonsStore?: LessonsStore;
  retriever?: AlgorithmAwareRetriever;
}

export class StrategyMemoryProvider implements MemoryProvider {
  readonly id = 'strategy';
  private readonly memoryStore: MemoryStore;
  private readonly lessonsStore: LessonsStore | undefined;
  private readonly retriever: AlgorithmAwareRetriever;
  private strategy: MemoryStrategy | undefined;

  constructor(options: StrategyMemoryProviderOptions) {
    this.memoryStore = options.memoryStore;
    this.lessonsStore = options.lessonsStore;
    this.retriever = options.retriever ?? createAlgorithmAwareRetriever(options.memoryStore);
  }

  async initialize(_context: MemoryProviderContext, strategy?: MemoryStrategy): Promise<void> {
    this.strategy = strategy;
  }

  async prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult> {
    const limit = request.limit || this.strategy?.maxSlices || 10;
    const doubleLoop = this.lessonsStore
      ? this.lessonsStore
        .topN(limit * 3, { tags: ['double_loop', 'approved'] })
        .filter((lesson) => lesson.tags.includes('double_loop') && lesson.tags.includes('approved'))
        .filter((lesson) => !hasAnyTag(lesson.tags, ['legacy', 'rejected', 'quarantined']))
        .filter((lesson) => !request.projectId || lesson.tags.includes(`project:${request.projectId}`))
        .slice(0, limit)
        .map(lessonToSlice)
      : [];
    const retrieved = request.algorithm
      ? await this.retriever.retrieve({
        consumer: request.nodeKind === 'toolforge' ? 'toolforger' : 'strategist',
        projectId: request.projectId,
        algorithms: [request.algorithm],
        phases: request.phase ? [request.phase] : undefined,
        nodeKinds: request.nodeKind ? [request.nodeKind] : undefined,
        ruleKeys: request.ruleKeys,
        kinds: ['double_loop', 'single_loop', 'strategy'],
        statuses: ['approved'],
        excludeLegacy: true,
        limit,
      })
      : [];
    const strategyEntries = this.memoryStore.query({
      kind: ['lesson', 'strategy'],
      tags: ['strategy', 'approved', ...(request.projectId ? [`project:${request.projectId}`] : [])],
      limit,
    })
      .filter((entry) => !hasAnyTag(entry.tags, ['legacy', 'rejected', 'quarantined']))
      .map(memoryEntryToSlice);

    const slices = [...doubleLoop, ...retrieved, ...strategyEntries]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
    return { slices };
  }

  async syncTurn(_turn: MemoryTurnSync): Promise<MemoryWriteResult> {
    return { wrote: 0, skipped: 0 };
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.memoryStore.query(query);
  }

  async compress(_scope: CompressionScope): Promise<CompressionReport> {
    return {
      providerId: this.id,
      compressed: 0,
      retained: 0,
      dropped: 0,
    };
  }

  async shutdown(): Promise<void> {
    return;
  }
}

function lessonToSlice(lesson: LessonEntry): MemorySlice {
  return {
    id: lesson.id,
    providerId: 'strategy',
    priority: 100 + lesson.weight,
    content: lesson.text,
    sourceRefs: [`lesson:${lesson.id}`],
  };
}

function memoryEntryToSlice(entry: MemoryEntry): MemorySlice {
  return {
    id: entry.id,
    providerId: 'strategy',
    priority: 50 + entry.weight,
    content: entry.text,
    sourceRefs: [entry.source],
  };
}

function hasAnyTag(itemTags: string[], tags: string[]): boolean {
  return tags.some((tag) => itemTags.includes(tag));
}
