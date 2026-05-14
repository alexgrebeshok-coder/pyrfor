import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { StrategyEntry, StrategyListQuery, StrategySetInput } from './types';
export interface StrategyStore {
    setApproved(input: StrategySetInput): StrategyEntry;
    getApproved(key: string, options?: {
        projectId?: string;
        includeGlobal?: boolean;
    }): StrategyEntry | undefined;
    listApproved(query?: StrategyListQuery): StrategyEntry[];
}
export declare function createStrategyStore(memoryStore: MemoryStore): StrategyStore;
export declare function entryToStrategy(entry: MemoryEntry): StrategyEntry;
//# sourceMappingURL=strategy-store.d.ts.map