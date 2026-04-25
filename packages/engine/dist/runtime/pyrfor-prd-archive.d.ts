/**
 * pyrfor-prd-archive.ts — FTS5-backed PRD/spec archive for Pyrfor.
 *
 * ## Design choices
 * - An in-memory Map<id, PrdRecord> mirror handles `get` / `listByTask` lookups
 *   without requiring the store to support keyed retrieval.
 * - The injected `MemoryStoreLike` is intentionally minimal for testability.
 *
 * ## Real MemoryStore adapter mapping (for production wiring)
 * | MemoryStoreLike method | MemoryStore equivalent                              |
 * |------------------------|------------------------------------------------------|
 * | add({id, text, tags, scope, meta}) | store.add({kind:'reference', source: id,   |
 * |                        |   text, scope, tags: [...tags, `prd-id:${id}`],     |
 * |                        |   weight: 0.5}) — id stored in `source` + tag      |
 * | remove(id)             | query({scope, tags:[`prd-id:${id}`]}).forEach(e => |
 * |                        |   store.delete(e.id))                               |
 * | search(q, opts)        | store.search(q, {scope, limit: topK}) then filter   |
 * |                        |   tags; score approximated as rank order (1/index)  |
 * Note: `MemoryStore.search` does not expose the BM25 score column; production
 * adapters should assign a proxy score (e.g. 1 / (rank + 1)).
 */
export interface PrdRecord {
    id: string;
    taskId: string;
    title: string;
    body: string;
    tags: string[];
    createdAt: number;
    updatedAt: number;
}
export interface PrdStore {
    upsert(record: Omit<PrdRecord, 'createdAt' | 'updatedAt'> & {
        createdAt?: number;
        updatedAt?: number;
    }): Promise<PrdRecord>;
    get(id: string): Promise<PrdRecord | null>;
    search(query: string, opts?: {
        topK?: number;
        tags?: string[];
        taskId?: string;
    }): Promise<Array<PrdRecord & {
        score: number;
    }>>;
    remove(id: string): Promise<boolean>;
    listByTask(taskId: string): Promise<PrdRecord[]>;
}
/**
 * Minimal async store interface — inject a real adapter or the test fake below.
 */
export interface MemoryStoreLike {
    add(args: {
        id: string;
        text: string;
        tags: string[];
        scope: string;
        meta?: Record<string, unknown>;
    }): Promise<void>;
    remove(id: string): Promise<boolean>;
    search(q: string, opts?: {
        topK?: number;
        tags?: string[];
        scope?: string;
    }): Promise<Array<{
        id: string;
        text: string;
        tags: string[];
        meta: Record<string, unknown>;
        score: number;
    }>>;
}
export declare class PrdArchive implements PrdStore {
    private readonly store;
    private readonly scope;
    /** In-memory mirror for O(1) get / listByTask — avoids a store round-trip. */
    private readonly mirror;
    constructor(opts: {
        store: MemoryStoreLike;
        scope?: string;
    });
    upsert(record: Omit<PrdRecord, 'createdAt' | 'updatedAt'> & {
        createdAt?: number;
        updatedAt?: number;
    }): Promise<PrdRecord>;
    get(id: string): Promise<PrdRecord | null>;
    search(query: string, opts?: {
        topK?: number;
        tags?: string[];
        taskId?: string;
    }): Promise<Array<PrdRecord & {
        score: number;
    }>>;
    remove(id: string): Promise<boolean>;
    listByTask(taskId: string): Promise<PrdRecord[]>;
}
//# sourceMappingURL=pyrfor-prd-archive.d.ts.map