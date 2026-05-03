import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger } from './event-ledger';
import type { SessionStore } from './session-store';
import { type MemoryWriteOptions } from '../ai/memory/agent-memory-store';
export interface DailyMemoryRollupInput {
    workspaceId: string;
    date?: string;
    agentId?: string;
    projectId?: string;
    sessionLimit?: number;
}
export interface DailyMemoryRollupResult {
    date: string;
    workspaceId: string;
    agentId: string;
    sessionCount: number;
    messageCount: number;
    ledgerEventCount: number;
    runIds: string[];
    summary: string;
    content: string;
    memoryId: string;
    artifact?: ArtifactRef;
}
export interface DailyMemoryRollupDeps {
    sessionStore: SessionStore;
    eventLedger?: EventLedger;
    artifactStore?: ArtifactStore;
    memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
    now?: () => Date;
}
export declare function createDailyMemoryRollup(deps: DailyMemoryRollupDeps, input: DailyMemoryRollupInput): Promise<DailyMemoryRollupResult>;
//# sourceMappingURL=memory-rollup.d.ts.map