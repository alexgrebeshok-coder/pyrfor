import type { MemoryStore } from '../../memory-store';
import type { GovernedAlgorithm } from '../completion-gate-engine';
import type { DoubleLoopStatus, MemorySlice, NodeKind } from './types';
export interface AlgorithmAwareRetrieveRequest {
    consumer: 'strategist' | 'toolforger';
    projectId?: string;
    algorithms: GovernedAlgorithm[];
    phases?: string[];
    nodeKinds?: NodeKind[];
    ruleKeys?: string[];
    kinds?: Array<'single_loop' | 'double_loop' | 'strategy'>;
    statuses?: DoubleLoopStatus[];
    excludeLegacy?: boolean;
    limit: number;
}
export interface RetrievedMemory extends MemorySlice {
    tags: string[];
    applicabilityScore: number;
    observedImpactScore: number;
    confidenceScore: number;
    recencyScore: number;
}
export interface AlgorithmAwareRetriever {
    retrieve(req: AlgorithmAwareRetrieveRequest): Promise<RetrievedMemory[]>;
}
export declare function createAlgorithmAwareRetriever(memoryStore: MemoryStore): AlgorithmAwareRetriever;
//# sourceMappingURL=algorithm-aware-retriever.d.ts.map