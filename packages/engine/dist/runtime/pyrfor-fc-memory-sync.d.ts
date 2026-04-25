/**
 * pyrfor-fc-memory-sync.ts — Read-only FreeClaude memory → Pyrfor MemoryStore sync.
 *
 * Imports FC memory entries into Pyrfor for searching/cross-referencing.
 * FC remains the source of truth; we never write back to ~/.freeclaude.
 */
import type { MemoryStore } from './memory-store';
export interface FcMemoryEntry {
    key: string;
    value: string;
    createdAt?: string;
    updatedAt?: string;
    tags?: string[];
}
export interface FcEmbeddingEntry {
    key: string;
    value: string;
    embedding?: number[];
    updatedAt?: string;
}
export interface FcMemorySnapshot {
    memory: FcMemoryEntry[];
    embeddings: FcEmbeddingEntry[];
    embeddingModel?: string;
    loadedAt: number;
}
export interface FcMemorySyncOptions {
    /** Path to memory.json. Default: ~/.freeclaude/memory.json. */
    memoryPath?: string;
    /** Path to embeddings.json. Default: ~/.freeclaude/embeddings.json. */
    embeddingsPath?: string;
    /** Memory store to sync into. */
    store: MemoryStore;
    /** Scope for synced entries. Default: 'fc-import'. */
    scope?: string;
    /** Source string. Default: 'freeclaude'. */
    source?: string;
    /** Filesystem (for tests). Default: node:fs. */
    fs?: {
        existsSync: (p: string) => boolean;
        readFileSync: (p: string, enc: 'utf8') => string;
    };
    /** Clock. */
    now?: () => number;
}
/**
 * Load FC memory snapshot from disk (no DB writes).
 * Missing files → empty arrays, not throw.
 */
export declare function loadFcMemorySnapshot(opts: Pick<FcMemorySyncOptions, 'memoryPath' | 'embeddingsPath' | 'fs' | 'now'>): FcMemorySnapshot;
/**
 * Sync snapshot into MemoryStore. Returns { added, skipped, total }.
 * Idempotent: re-running with same data adds 0.
 *
 * TODO: Future enhancement — extend memory-store with embedding column to support
 * vector search. Currently, embeddings are preserved in snapshot but not stored.
 */
export declare function syncFcMemoryToStore(snapshot: FcMemorySnapshot, opts: FcMemorySyncOptions): {
    added: number;
    skipped: number;
    total: number;
};
/**
 * Convenience: load + sync.
 */
export declare function syncFcMemory(opts: FcMemorySyncOptions): {
    added: number;
    skipped: number;
    total: number;
    snapshot: FcMemorySnapshot;
};
//# sourceMappingURL=pyrfor-fc-memory-sync.d.ts.map