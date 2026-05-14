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
export type MemoryImportState = "native" | "imported_quarantined" | "approved" | "rejected" | "superseded" | "legacy";
export type MemoryApprovalState = "pending_approval" | "approved" | "rejected";
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
    importState?: MemoryImportState;
    approvalState?: MemoryApprovalState;
    plannerEligible?: boolean;
    importedAt?: string;
    importedFrom?: string;
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
    audience?: "audit" | "planner";
}
export interface DurableMemorySearchOptions extends MemorySearchOptions {
    scope?: MemoryScopeFilter;
    projectMemoryCategories?: string[];
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
    skipShortTerm?: boolean;
}
export interface ImportedMemoryRevocationOptions {
    memoryIds: string[];
    agentId?: string;
    workspaceId?: string;
    projectId?: string;
    migratedFrom: 'openclaw';
    reason: string;
    revokedAt?: Date;
}
export interface MemoryRevocationResult {
    requested: number;
    matched: number;
    revoked: number;
    missingIds: string[];
    skippedIds: string[];
    alreadyRevokedIds: string[];
}
export type MemoryReviewDecision = "approve" | "reject";
export interface DurableMemoryReviewOptions {
    memoryId: string;
    decision: MemoryReviewDecision;
    operatorId: string;
    reason?: string;
    agentId?: string;
    workspaceId?: string;
    projectId?: string;
    reviewedAt?: Date;
}
export interface DurableMemoryContradiction {
    memoryId: string;
    reason: 'summary_mismatch' | 'source_mismatch';
}
export declare class DurableMemoryContradictionError extends Error {
    readonly conflictingMemoryIds: string[];
    readonly contradictions: DurableMemoryContradiction[];
    constructor(contradictions: DurableMemoryContradiction[]);
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
    projectId?: string;
    importance?: number;
    memoryType?: MemoryType;
}): void;
export declare function recallShortTerm(agentId: string, query: string, options?: {
    workspaceId?: string;
    projectId?: string;
    limit?: number;
}): string[];
export declare function storeMemory(options: MemoryWriteOptions): Promise<string>;
export declare function revokeImportedMemories(options: ImportedMemoryRevocationOptions): Promise<MemoryRevocationResult>;
export declare function reviewDurableMemory(options: DurableMemoryReviewOptions): Promise<MemoryEntry>;
export declare function searchMemory(opts: MemorySearchOptions): Promise<MemoryEntry[]>;
export declare function searchDurableMemoryForContext(opts: DurableMemorySearchOptions): Promise<MemoryEntry[]>;
export declare function listPendingDurableMemoryReviews(opts: {
    agentId: string;
    workspaceId?: string;
    projectId?: string;
    limit?: number;
}): Promise<MemoryEntry[]>;
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