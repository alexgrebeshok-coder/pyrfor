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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ── PrdArchive ────────────────────────────────────────────────────────────────
export class PrdArchive {
    constructor(opts) {
        var _a;
        /** In-memory mirror for O(1) get / listByTask — avoids a store round-trip. */
        this.mirror = new Map();
        this.store = opts.store;
        this.scope = (_a = opts.scope) !== null && _a !== void 0 ? _a : 'prd';
    }
    upsert(record) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const now = Date.now();
            const existing = this.mirror.get(record.id);
            const createdAt = (_b = (_a = existing === null || existing === void 0 ? void 0 : existing.createdAt) !== null && _a !== void 0 ? _a : record.createdAt) !== null && _b !== void 0 ? _b : now;
            const updatedAt = (_c = record.updatedAt) !== null && _c !== void 0 ? _c : now;
            const full = {
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
            yield this.store.remove(full.id);
            yield this.store.add({
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
        });
    }
    get(id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            return (_a = this.mirror.get(id)) !== null && _a !== void 0 ? _a : null;
        });
    }
    search(query, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const searchTags = [...((_a = opts === null || opts === void 0 ? void 0 : opts.tags) !== null && _a !== void 0 ? _a : [])];
            if ((opts === null || opts === void 0 ? void 0 : opts.taskId) !== undefined) {
                searchTags.push(`task:${opts.taskId}`);
            }
            const results = yield this.store.search(query, {
                topK: opts === null || opts === void 0 ? void 0 : opts.topK,
                tags: searchTags.length > 0 ? searchTags : undefined,
                scope: this.scope,
            });
            const out = [];
            for (const r of results) {
                const rec = this.mirror.get(r.id);
                if (rec !== undefined) {
                    out.push(Object.assign(Object.assign({}, rec), { score: r.score }));
                }
            }
            return out;
        });
    }
    remove(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const had = this.mirror.has(id);
            this.mirror.delete(id);
            yield this.store.remove(id);
            return had;
        });
    }
    listByTask(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const out = [];
            for (const rec of this.mirror.values()) {
                if (rec.taskId === taskId)
                    out.push(rec);
            }
            return out;
        });
    }
}
