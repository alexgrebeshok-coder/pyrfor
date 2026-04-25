/**
 * memory-store.ts — SQLite-backed long-term memory for Pyrfor.
 *
 * Features:
 * - FTS5 full-text search with BM25 ranking
 * - Content-table triggers keep FTS in sync (AI/AD/AU)
 * - Scoped queries, tag filtering, expiry, pruning
 * - In-process, synchronous better-sqlite3 for zero-latency reads
 */
export type MemoryKind = 'fact' | 'preference' | 'episode' | 'reference' | 'lesson';
export interface MemoryEntry {
    id: string;
    kind: MemoryKind;
    text: string;
    source: string;
    scope: string;
    tags: string[];
    weight: number;
    applied_count: number;
    created_at: string;
    updated_at: string;
    expires_at?: string;
}
export interface MemoryQuery {
    scope?: string;
    kind?: MemoryKind | MemoryKind[];
    tags?: string[];
    search?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    includeExpired?: boolean;
}
export interface MemoryStoreOptions {
    dbPath?: string;
    tokenizer?: string;
}
export interface MemoryStore {
    add(input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>): MemoryEntry;
    update(id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'weight' | 'expires_at' | 'kind' | 'scope'>>): MemoryEntry | null;
    get(id: string): MemoryEntry | null;
    delete(id: string): boolean;
    query(q?: MemoryQuery): MemoryEntry[];
    search(text: string, opts?: {
        scope?: string;
        limit?: number;
    }): MemoryEntry[];
    recordApplied(id: string): void;
    prune(opts?: {
        olderThanDays?: number;
        maxRows?: number;
    }): number;
    count(): number;
    close(): void;
    exportAll(): MemoryEntry[];
    importMany(entries: MemoryEntry[]): number;
}
/** Wrap user input in double-quotes for FTS5 phrase safety. */
export declare function escapeFtsQuery(q: string): string;
export declare function createMemoryStore(opts?: MemoryStoreOptions): MemoryStore;
//# sourceMappingURL=memory-store.d.ts.map