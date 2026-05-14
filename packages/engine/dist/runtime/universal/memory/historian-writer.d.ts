import type { ApprovalDecision, ApprovalRequest } from '../../approval-flow';
import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { EventLedger } from '../../event-ledger';
import { type HistorianDistillInput } from '../historian';
import type { GovernedAlgorithm } from '../completion-gate-engine';
import type { StrategySetInput } from './types';
import { type StrategyStore } from './strategy-store';
export interface HistorianProvenance {
    runId: string;
    conceptId?: string;
    nodeId: string;
    artifactRefs: string[];
    algorithm: GovernedAlgorithm;
}
export interface HistorianApprovalFlow {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
export interface HistorianWriterDeps {
    memoryStore: MemoryStore;
    approvalFlow: HistorianApprovalFlow;
    ledger: EventLedger;
    strategyStore?: StrategyStore;
}
export interface HistorianWriteResult {
    singleLoopEntry?: MemoryEntry;
    doubleLoopEntry?: MemoryEntry;
    conflictRequests: string[];
}
export declare function persistLessons(input: HistorianDistillInput, provenance: HistorianProvenance, deps: HistorianWriterDeps): Promise<HistorianWriteResult>;
export declare function promoteDoubleLoop(entryId: string, approvedBy: string, deps: Pick<HistorianWriterDeps, 'memoryStore' | 'ledger'>): Promise<MemoryEntry | null>;
export declare function quarantineDoubleLoop(entryId: string, reason: string, deps: Pick<HistorianWriterDeps, 'memoryStore' | 'ledger'>): Promise<MemoryEntry | null>;
export declare function writeStrategyOrConflict(input: StrategySetInput, provenance: HistorianProvenance, deps: HistorianWriterDeps): Promise<{
    wrote: MemoryEntry;
} | {
    conflictId: string;
}>;
export declare class HistorianWriterError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=historian-writer.d.ts.map