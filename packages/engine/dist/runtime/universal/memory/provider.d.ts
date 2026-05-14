import type { ArtifactStore } from '../../artifact-model';
import type { EventLedger } from '../../event-ledger';
import type { MemoryEntry, MemoryQuery, MemoryStore } from '../../memory-store';
import type { MemoryPrefetchRequest, MemoryPrefetchResult, MemoryTurnSync, MemoryWriteResult } from './types';
export interface MemoryProviderContext {
    runId: string;
    workspaceId: string;
    projectId?: string;
    eventLedger?: EventLedger;
    artifactStore?: ArtifactStore;
    memoryStore?: MemoryStore;
}
export interface MemoryStrategy {
    readonly strategyId: string;
    readonly preferDoubleLoop?: boolean;
    readonly maxSlices?: number;
}
export interface CompressionScope {
    runId: string;
    providerId?: string;
    maxEntries?: number;
}
export interface CompressionReport {
    providerId: string;
    compressed: number;
    retained: number;
    dropped: number;
}
export interface MemoryProvider {
    readonly id: string;
    initialize(context: MemoryProviderContext, strategy?: MemoryStrategy): Promise<void>;
    prefetch(request: MemoryPrefetchRequest): Promise<MemoryPrefetchResult>;
    syncTurn(turn: MemoryTurnSync): Promise<MemoryWriteResult>;
    query(query: MemoryQuery): Promise<MemoryEntry[]>;
    compress(scope: CompressionScope): Promise<CompressionReport>;
    shutdown(reason?: 'completed' | 'failed' | 'cancelled' | 'process_exit'): Promise<void>;
}
//# sourceMappingURL=provider.d.ts.map