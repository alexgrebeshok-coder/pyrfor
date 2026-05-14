import type { MemoryEntry, MemoryQuery, MemoryStore } from '../../memory-store';
import type { LessonsStore } from '../../ralph-lessons-store';
import { type AlgorithmAwareRetriever } from './algorithm-aware-retriever';
import type { MemoryPrefetchRequest, MemoryPrefetchResult, MemoryTurnSync, MemoryWriteResult } from './types';
import type { CompressionReport, CompressionScope, MemoryProvider, MemoryProviderContext, MemoryStrategy } from './provider';
export interface StrategyMemoryProviderOptions {
    memoryStore: MemoryStore;
    lessonsStore?: LessonsStore;
    retriever?: AlgorithmAwareRetriever;
}
export declare class StrategyMemoryProvider implements MemoryProvider {
    readonly id = "strategy";
    private readonly memoryStore;
    private readonly lessonsStore;
    private readonly retriever;
    private strategy;
    constructor(options: StrategyMemoryProviderOptions);
    initialize(_context: MemoryProviderContext, strategy?: MemoryStrategy): Promise<void>;
    prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult>;
    syncTurn(_turn: MemoryTurnSync): Promise<MemoryWriteResult>;
    query(query: MemoryQuery): Promise<MemoryEntry[]>;
    compress(_scope: CompressionScope): Promise<CompressionReport>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=strategy-memory-provider.d.ts.map