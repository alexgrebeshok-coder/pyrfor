import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import type { BlockRegistry } from '../../block-registry';
import type { MemoryPrefetchRequest, MemoryPrefetchResult } from './types';
import type { StrategyMemoryProvider } from './strategy-memory-provider';
export interface UniversalMemoryFacadeOptions {
    memoryStore: MemoryStore;
    strategyProvider: StrategyMemoryProvider;
    lessonsStore?: LessonsStore;
    blockRegistry?: BlockRegistry;
}
export interface UniversalMemoryFacade {
    prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult>;
    queryApprovedLessons(request: {
        projectId?: string;
        limit: number;
    }): MemoryEntry[];
    queryApprovedStrategies(request: {
        projectId?: string;
        limit: number;
    }): MemoryEntry[];
}
export declare function createUniversalMemoryFacade(options: UniversalMemoryFacadeOptions): UniversalMemoryFacade;
//# sourceMappingURL=memory-facade.d.ts.map