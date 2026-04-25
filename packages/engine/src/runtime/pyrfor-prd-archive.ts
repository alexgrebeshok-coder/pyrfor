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

// ── Public types ──────────────────────────────────────────────────────────────

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
  upsert(
    record: Omit<PrdRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number },
  ): Promise<PrdRecord>;
  get(id: string): Promise<PrdRecord | null>;
  search(
    query: string,
    opts?: { topK?: number; tags?: string[]; taskId?: string },
  ): Promise<Array<PrdRecord & { score: number }>>;
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
  search(
    q: string,
    opts?: { topK?: number; tags?: string[]; scope?: string },
  ): Promise<Array<{ id: string; text: string; tags: string[]; meta: Record<string, unknown>; score: number }>>;
}

// ── PrdArchive ────────────────────────────────────────────────────────────────

export class PrdArchive implements PrdStore {
  private readonly store: MemoryStoreLike;
  private readonly scope: string;
  /** In-memory mirror for O(1) get / listByTask — avoids a store round-trip. */
  private readonly mirror = new Map<string, PrdRecord>();

  constructor(opts: { store: MemoryStoreLike; scope?: string }) {
    this.store = opts.store;
    this.scope = opts.scope ?? 'prd';
  }

  async upsert(
    record: Omit<PrdRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number },
  ): Promise<PrdRecord> {
    const now = Date.now();
    const existing = this.mirror.get(record.id);
    const createdAt = existing?.createdAt ?? record.createdAt ?? now;
    const updatedAt = record.updatedAt ?? now;

    const full: PrdRecord = {
      id: record.id,
      taskId: record.taskId,
      title: record.title,
      body: record.body,
      tags: record.tags,
      createdAt,
      updatedAt,
    };

    this.mirror.set(full.id, full);

    // Remove stale entry then re-add so FTS reflects latest text/tags
    await this.store.remove(full.id);
    await this.store.add({
      id: full.id,
      text: `${full.title}\n\n${full.body}`,
      tags: [...full.tags, `task:${full.taskId}`],
      scope: this.scope,
      meta: {
        taskId: full.taskId,
        title: full.title,
        createdAt: full.createdAt,
        updatedAt: full.updatedAt,
      },
    });

    return full;
  }

  async get(id: string): Promise<PrdRecord | null> {
    return this.mirror.get(id) ?? null;
  }

  async search(
    query: string,
    opts?: { topK?: number; tags?: string[]; taskId?: string },
  ): Promise<Array<PrdRecord & { score: number }>> {
    const searchTags: string[] = [...(opts?.tags ?? [])];
    if (opts?.taskId !== undefined) {
      searchTags.push(`task:${opts.taskId}`);
    }

    const results = await this.store.search(query, {
      topK: opts?.topK,
      tags: searchTags.length > 0 ? searchTags : undefined,
      scope: this.scope,
    });

    const out: Array<PrdRecord & { score: number }> = [];
    for (const r of results) {
      const rec = this.mirror.get(r.id);
      if (rec !== undefined) {
        out.push({ ...rec, score: r.score });
      }
    }
    return out;
  }

  async remove(id: string): Promise<boolean> {
    const had = this.mirror.has(id);
    this.mirror.delete(id);
    await this.store.remove(id);
    return had;
  }

  async listByTask(taskId: string): Promise<PrdRecord[]> {
    const out: PrdRecord[] = [];
    for (const rec of this.mirror.values()) {
      if (rec.taskId === taskId) out.push(rec);
    }
    return out;
  }
}
