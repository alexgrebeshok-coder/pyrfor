import type { MemoryType } from '../ai/memory/agent-memory-store';
export type ContextPackSchemaVersion = 'context_pack.v1';
export type ContextSectionKind = 'task_contract' | 'policy' | 'workspace' | 'files' | 'ledger' | 'session' | 'dag' | 'memory' | 'domain';
export interface ContextSourceRef {
    kind: 'task' | 'workspace_file' | 'file' | 'ledger_event' | 'dag_node' | 'session' | 'memory' | 'policy' | 'domain_fact';
    ref: string;
    role: 'input' | 'policy' | 'evidence' | 'history' | 'memory' | 'constraint';
    sha256?: string;
    meta?: Record<string, unknown>;
}
export interface ContextPackSection {
    id: string;
    kind: ContextSectionKind;
    title: string;
    priority: number;
    content: unknown;
    sources: ContextSourceRef[];
}
export interface ContextTaskContract {
    id?: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
    constraints?: string[];
    nonGoals?: string[];
}
export interface ContextMemoryEntry {
    id: string;
    memoryType: MemoryType;
    projectMemoryCategory?: string;
    content: string;
    summary?: string;
    importance: number;
    provenance?: unknown;
    scope?: unknown;
    confidence?: number;
    lastValidatedAt?: string;
    frozen?: boolean;
}
export interface ContextPack {
    schemaVersion: ContextPackSchemaVersion;
    packId: string;
    hash: string;
    compiledAt: string;
    runId?: string;
    workspaceId: string;
    projectId?: string;
    task: ContextTaskContract;
    sections: ContextPackSection[];
    sourceRefs: ContextSourceRef[];
}
export declare function stableStringify(value: unknown): string;
export declare function hashContextPack(pack: Omit<ContextPack, 'hash'>): string;
export declare function withContextPackHash(pack: Omit<ContextPack, 'hash'>): ContextPack;
//# sourceMappingURL=context-pack.d.ts.map