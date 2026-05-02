/**
 * Agent Memory Store
 *
 * Provides short-term (in-process) and long-term (database) memory for agents.
 *
 * Memory types:
 * - episodic: specific events ("Project X was delayed 2 weeks in January")
 * - semantic: factual knowledge ("Project X has 5 active risks")
 * - procedural: workflow knowledge ("Always check budget before approving tasks")
 * - policy: governance constraints that must outrank project/task memory
 *
 * Storage:
 * - Short-term: LRU in-process Map (per agentId, TTL 30 min)
 * - Long-term: Prisma AgentMemory table (JSON-backed, upgradeable to pgvector)
 *
 * Retrieval: keyword BM25-style scoring (no embedding required).
 * When pgvector becomes available, swap embeddingJson for vector similarity.
 */
export type MemoryType = "episodic" | "semantic" | "procedural" | "policy";
export type MemoryVisibility = "member" | "project" | "workspace" | "family" | "global";
export interface MemoryProvenanceRef {
    kind: "run" | "session" | "ledger_event" | "artifact" | "user" | "system" | "external";
    ref: string;
    ts?: string;
}
export interface MemoryScope {
    visibility: MemoryVisibility;
    workspaceId?: string;
    projectId?: string;
    familyId?: string;
    memberId?: string;
}
export interface MemoryGovernance {
    provenance?: MemoryProvenanceRef[];
    scope?: MemoryScope;
    confidence?: number;
    retention?: {
        expiresAt?: string;
        ttlDays?: number;
    };
    lastValidatedAt?: string;
    revoked?: boolean;
    frozen?: boolean;
}
export type StructuredMemoryMetadata = MemoryGovernance & Record<string, unknown>;
export interface MemoryEntry {
    id: string;
    agentId: string;
    workspaceId?: string;
    projectId?: string;
    memoryType: MemoryType;
    content: string;
    summary?: string;
    importance: number;
    createdAt: Date;
    metadata?: StructuredMemoryMetadata;
}
export interface MemorySearchOptions {
    agentId: string;
    query: string;
    workspaceId?: string;
    projectId?: string;
    memoryType?: MemoryType;
    limit?: number;
    minImportance?: number;
}
export interface MemoryWriteOptions {
    agentId: string;
    workspaceId?: string;
    projectId?: string;
    memoryType?: MemoryType;
    content: string;
    summary?: string;
    importance?: number;
    expiresInDays?: number;
    metadata?: StructuredMemoryMetadata;
}
export interface MemoryScopeFilter {
    visibility: MemoryVisibility;
    workspaceId?: string;
    projectId?: string;
    familyId?: string;
    memberId?: string;
    now?: Date;
}
export declare function storeShortTerm(agentId: string, content: string, options?: {
    workspaceId?: string;
    importance?: number;
    memoryType?: MemoryType;
}): void;
export declare function recallShortTerm(agentId: string, query: string, options?: {
    workspaceId?: string;
    limit?: number;
}): string[];
export declare function storeMemory(options: MemoryWriteOptions): Promise<string>;
export declare function searchMemory(opts: MemorySearchOptions): Promise<MemoryEntry[]>;
/**
 * Build a memory context string to inject into an agent's system prompt.
 * Returns empty string if no relevant memories found.
 */
export declare function buildMemoryContext(agentId: string, query: string, options?: {
    workspaceId?: string;
    projectId?: string;
    limit?: number;
}): Promise<string>;
export declare function filterMemoryForScope(entries: MemoryEntry[], scope: MemoryScopeFilter): MemoryEntry[];
//# sourceMappingURL=agent-memory-store.d.ts.map