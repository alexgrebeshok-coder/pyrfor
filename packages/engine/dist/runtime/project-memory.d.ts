import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger } from './event-ledger';
import type { SessionStore } from './session-store';
import { type MemoryType, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';
export type ProjectMemoryCategory = 'decision' | 'convention' | 'risk' | 'active_thread' | 'unresolved_task';
export interface ProjectMemoryRollupInput {
    workspaceId: string;
    projectId: string;
    agentId?: string;
    sessionLimit?: number;
}
export interface ProjectMemoryCategoryResult {
    category: ProjectMemoryCategory;
    memoryType: MemoryType;
    summary: string;
    content: string;
    memoryId: string;
}
export interface ProjectMemoryRollupResult {
    workspaceId: string;
    projectId: string;
    agentId: string;
    sessionCount: number;
    ledgerEventCount: number;
    runIds: string[];
    artifact?: ArtifactRef;
    memories: ProjectMemoryCategoryResult[];
}
export interface ProjectMemoryRollupDeps {
    sessionStore: SessionStore;
    eventLedger?: EventLedger;
    artifactStore?: ArtifactStore;
    memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
    now?: () => Date;
}
export declare function createProjectMemoryRollup(deps: ProjectMemoryRollupDeps, input: ProjectMemoryRollupInput): Promise<ProjectMemoryRollupResult>;
//# sourceMappingURL=project-memory.d.ts.map