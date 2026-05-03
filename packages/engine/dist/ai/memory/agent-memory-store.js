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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../../observability/logger.js';
// ============================================
// Short-term memory (in-process, TTL-based)
// ============================================
const SHORT_TERM_TTL = 30 * 60 * 1000; // 30 minutes
const SHORT_TERM_MAX_PER_AGENT = 50;
const _shortTermStore = new Map();
function shortTermKey(agentId, workspaceId, projectId) {
    const workspaceKey = workspaceId ? `${agentId}:${workspaceId}` : agentId;
    return projectId ? `${workspaceKey}:project:${projectId}` : workspaceKey;
}
export function storeShortTerm(agentId, content, options = {}) {
    var _a, _b, _c;
    const key = shortTermKey(agentId, options.workspaceId, options.projectId);
    const now = Date.now();
    const existing = filterAliveShortTermEntries((_a = _shortTermStore.get(key)) !== null && _a !== void 0 ? _a : [], now);
    existing.push({
        content,
        createdAt: now,
        importance: (_b = options.importance) !== null && _b !== void 0 ? _b : 0.5,
        memoryType: (_c = options.memoryType) !== null && _c !== void 0 ? _c : "episodic",
        projectId: options.projectId,
    });
    const sorted = existing
        .sort((a, b) => b.importance - a.importance)
        .slice(0, SHORT_TERM_MAX_PER_AGENT);
    _shortTermStore.set(key, sorted);
}
export function recallShortTerm(agentId, query, options = {}) {
    var _a, _b;
    const key = shortTermKey(agentId, options.workspaceId, options.projectId);
    const now = Date.now();
    const entries = filterAliveShortTermEntries((_a = _shortTermStore.get(key)) !== null && _a !== void 0 ? _a : [], now);
    _shortTermStore.set(key, entries);
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const limit = (_b = options.limit) !== null && _b !== void 0 ? _b : 5;
    return entries
        .map((e) => {
        const lc = e.content.toLowerCase();
        const score = queryTerms.reduce((acc, term) => acc + (lc.includes(term) ? 1 : 0), 0) *
            e.importance;
        return { content: e.content, score };
    })
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((e) => e.content);
}
// ============================================
// Long-term memory (database)
// ============================================
const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
/** Pre-compile regex patterns once per query — avoids O(terms × rows) RegExp allocations. */
function compileTermPatterns(queryTerms) {
    const map = new Map();
    for (const term of queryTerms) {
        if (!term)
            continue;
        if (map.has(term))
            continue;
        map.set(term, new RegExp(term.replace(REGEX_ESCAPE, "\\$&"), "g"));
    }
    return map;
}
/** Simple keyword scoring with a lightweight IDF approximation. */
function bm25Score(content, queryTerms, documentFrequency, totalDocs, termPatterns) {
    var _a;
    if (queryTerms.length === 0)
        return 0;
    const lc = content.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        const pattern = termPatterns.get(term);
        if (!pattern)
            continue;
        // RegExp with /g is stateful via lastIndex when using .exec; .match resets implicitly.
        const matches = lc.match(pattern);
        const count = matches ? matches.length : 0;
        if (count === 0)
            continue;
        const docFreq = (_a = documentFrequency.get(term)) !== null && _a !== void 0 ? _a : 1;
        const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
        const tf = (count * 2.2) / (count + 1.2);
        score += tf * idf;
    }
    return score;
}
export function storeMemory(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { prisma } = yield import('../../prisma.js');
            const expiresAt = options.expiresInDays
                ? new Date(Date.now() + options.expiresInDays * 86400000)
                : undefined;
            const record = yield prisma.agentMemory.create({
                data: {
                    agentId: options.agentId,
                    workspaceId: options.workspaceId,
                    projectId: options.projectId,
                    memoryType: (_a = options.memoryType) !== null && _a !== void 0 ? _a : "episodic",
                    content: options.content,
                    summary: options.summary,
                    importance: (_b = options.importance) !== null && _b !== void 0 ? _b : 0.5,
                    metadata: JSON.stringify((_c = options.metadata) !== null && _c !== void 0 ? _c : {}),
                    expiresAt,
                },
            });
            // Also keep in short-term for fast access
            storeShortTerm(options.agentId, options.content, {
                workspaceId: options.workspaceId,
                projectId: options.projectId,
                importance: options.importance,
                memoryType: options.memoryType,
            });
            return record.id;
        }
        catch (err) {
            logger.warn("agent-memory: failed to persist to DB", {
                agentId: options.agentId,
                error: err instanceof Error ? err.message : String(err),
            });
            // Still store in short-term
            storeShortTerm(options.agentId, options.content, options);
            return "short-term-only";
        }
    });
}
export function searchMemory(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const limit = (_a = opts.limit) !== null && _a !== void 0 ? _a : 10;
        const queryTerms = opts.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        // Always check short-term first
        const shortTermResults = recallShortTerm(opts.agentId, opts.query, {
            workspaceId: opts.workspaceId,
            projectId: opts.projectId,
            limit: Math.ceil(limit / 2),
        });
        try {
            const { prisma } = yield import('../../prisma.js');
            const rows = yield prisma.agentMemory.findMany({
                where: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ agentId: opts.agentId }, (opts.workspaceId && { workspaceId: opts.workspaceId })), (opts.projectId && { projectId: opts.projectId })), (opts.memoryType && { memoryType: opts.memoryType })), (opts.minImportance !== undefined && { importance: { gte: opts.minImportance } })), { OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } },
                    ] }),
                orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
                take: limit * 3, // over-fetch for client-side scoring
            });
            const documentFrequency = buildDocumentFrequency(rows, queryTerms);
            const totalDocs = Math.max(rows.length, 1);
            const termPatterns = compileTermPatterns(queryTerms);
            // Score by keyword match
            const scored = rows
                .map((row) => {
                var _a;
                return ({
                    row,
                    score: bm25Score(row.content + " " + ((_a = row.summary) !== null && _a !== void 0 ? _a : ""), queryTerms, documentFrequency, totalDocs, termPatterns) + row.importance,
                });
            })
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
            // Update access counts in background
            const ids = scored.map((s) => s.row.id);
            if (ids.length > 0) {
                void prisma.agentMemory
                    .updateMany({
                    where: { id: { in: ids } },
                    data: {
                        accessCount: { increment: 1 },
                        lastAccessedAt: new Date(),
                    },
                })
                    .catch(() => { });
            }
            const entries = scored.map((s) => rowToMemoryEntry(s.row));
            // Merge short-term (deduplicate by content)
            const longTermContents = new Set(entries.map((e) => e.content));
            const shortTermEntries = shortTermResults
                .filter((c) => !longTermContents.has(c))
                .map((c, i) => ({
                id: `short:${i}`,
                agentId: opts.agentId,
                memoryType: "episodic",
                content: c,
                importance: 0.6,
                createdAt: new Date(),
            }));
            return [...shortTermEntries, ...entries].slice(0, limit);
        }
        catch (err) {
            logger.warn("agent-memory: DB search failed, returning short-term only", {
                error: err instanceof Error ? err.message : String(err),
            });
            return shortTermResults.map((c, i) => ({
                id: `short:${i}`,
                agentId: opts.agentId,
                memoryType: "episodic",
                content: c,
                importance: 0.6,
                createdAt: new Date(),
            }));
        }
    });
}
export function searchDurableMemoryForContext(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const limit = (_a = opts.limit) !== null && _a !== void 0 ? _a : 10;
        const queryTerms = opts.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        const scope = (_b = opts.scope) !== null && _b !== void 0 ? _b : {
            visibility: opts.projectId ? "project" : "workspace",
            workspaceId: opts.workspaceId,
            projectId: opts.projectId,
        };
        const scopeCandidates = [
            { workspaceId: null, projectId: null },
            ...(opts.workspaceId ? [{ workspaceId: opts.workspaceId }] : []),
            ...(opts.projectId ? [{ projectId: opts.projectId }] : []),
        ];
        try {
            const { prisma } = yield import('../../prisma.js');
            const rows = yield prisma.agentMemory.findMany({
                where: Object.assign(Object.assign(Object.assign({ agentId: opts.agentId }, (opts.memoryType && { memoryType: opts.memoryType })), (opts.minImportance !== undefined && { importance: { gte: opts.minImportance } })), { AND: [
                        {
                            OR: [
                                { expiresAt: null },
                                { expiresAt: { gt: new Date() } },
                            ],
                        },
                        { OR: scopeCandidates },
                    ] }),
                orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
                take: limit * 8,
            });
            const categories = new Set((_c = opts.projectMemoryCategories) !== null && _c !== void 0 ? _c : []);
            const scopedEntries = filterMemoryForScope(rows.map(rowToMemoryEntry), scope)
                .filter((entry) => {
                var _a;
                if (categories.size === 0)
                    return true;
                const category = (_a = entry.metadata) === null || _a === void 0 ? void 0 : _a.projectMemoryCategory;
                return typeof category === "string" && categories.has(category);
            });
            const documentFrequency = buildDocumentFrequency(scopedEntries, queryTerms);
            const totalDocs = Math.max(scopedEntries.length, 1);
            const termPatterns = compileTermPatterns(queryTerms);
            const scored = scopedEntries
                .map((entry) => {
                var _a;
                return ({
                    entry,
                    score: bm25Score(`${entry.content} ${(_a = entry.summary) !== null && _a !== void 0 ? _a : ""}`, queryTerms, documentFrequency, totalDocs, termPatterns) + entry.importance,
                });
            })
                .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
                .slice(0, limit);
            const ids = scored.map((item) => item.entry.id);
            if (ids.length > 0) {
                void prisma.agentMemory
                    .updateMany({
                    where: { id: { in: ids } },
                    data: {
                        accessCount: { increment: 1 },
                        lastAccessedAt: new Date(),
                    },
                })
                    .catch(() => { });
            }
            return scored.map((item) => item.entry);
        }
        catch (err) {
            logger.warn("agent-memory: durable context search failed", {
                agentId: opts.agentId,
                error: err instanceof Error ? err.message : String(err),
            });
            return [];
        }
    });
}
/**
 * Build a memory context string to inject into an agent's system prompt.
 * Returns empty string if no relevant memories found.
 */
export function buildMemoryContext(agentId_1, query_1) {
    return __awaiter(this, arguments, void 0, function* (agentId, query, options = {}) {
        var _a;
        const memories = yield searchMemory({
            agentId,
            query,
            workspaceId: options.workspaceId,
            projectId: options.projectId,
            limit: (_a = options.limit) !== null && _a !== void 0 ? _a : 5,
        });
        if (memories.length === 0)
            return "";
        const lines = memories.map((m) => { var _a; return `• ${(_a = m.summary) !== null && _a !== void 0 ? _a : m.content.slice(0, 200)}`; });
        return `## Relevant context from previous sessions:\n${lines.join("\n")}`;
    });
}
function filterAliveShortTermEntries(entries, now) {
    return entries.filter((entry) => now - entry.createdAt < SHORT_TERM_TTL);
}
export function filterMemoryForScope(entries, scope) {
    var _a;
    const now = (_a = scope.now) !== null && _a !== void 0 ? _a : new Date();
    return entries.filter((entry) => {
        var _a, _b;
        const metadata = (_a = entry.metadata) !== null && _a !== void 0 ? _a : {};
        if (metadata.revoked === true)
            return false;
        if (isExpired(metadata, now))
            return false;
        const entryScope = (_b = metadata.scope) !== null && _b !== void 0 ? _b : inferEntryScope(entry);
        return isVisibleInScope(entryScope, scope);
    });
}
function isExpired(metadata, now) {
    var _a;
    const expiresAt = (_a = metadata.retention) === null || _a === void 0 ? void 0 : _a.expiresAt;
    if (typeof expiresAt !== "string")
        return false;
    const ts = Date.parse(expiresAt);
    return Number.isFinite(ts) && ts <= now.getTime();
}
function inferEntryScope(entry) {
    if (entry.projectId) {
        return {
            visibility: "project",
            projectId: entry.projectId,
            workspaceId: entry.workspaceId,
        };
    }
    if (entry.workspaceId) {
        return { visibility: "workspace", workspaceId: entry.workspaceId };
    }
    return { visibility: "global" };
}
function isVisibleInScope(entryScope, target) {
    switch (entryScope.visibility) {
        case "member":
            return (target.visibility === "member" &&
                entryScope.memberId !== undefined &&
                entryScope.memberId === target.memberId);
        case "project":
            return ((target.visibility === "project" || target.visibility === "member") &&
                entryScope.workspaceId !== undefined &&
                entryScope.workspaceId === target.workspaceId &&
                entryScope.projectId !== undefined &&
                entryScope.projectId === target.projectId);
        case "workspace":
            return ((target.visibility === "workspace" || target.visibility === "project" || target.visibility === "member") &&
                entryScope.workspaceId !== undefined &&
                entryScope.workspaceId === target.workspaceId);
        case "family":
            return ((target.visibility === "family" || target.visibility === "member") &&
                entryScope.familyId !== undefined &&
                entryScope.familyId === target.familyId);
        case "global":
            return true;
    }
}
function safeParseMetadata(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch (_a) {
        return {};
    }
}
function rowToMemoryEntry(row) {
    var _a, _b, _c;
    return {
        id: row.id,
        agentId: row.agentId,
        workspaceId: (_a = row.workspaceId) !== null && _a !== void 0 ? _a : undefined,
        projectId: (_b = row.projectId) !== null && _b !== void 0 ? _b : undefined,
        memoryType: row.memoryType,
        content: row.content,
        summary: (_c = row.summary) !== null && _c !== void 0 ? _c : undefined,
        importance: row.importance,
        createdAt: row.createdAt,
        metadata: safeParseMetadata(row.metadata),
    };
}
function buildDocumentFrequency(rows, queryTerms) {
    var _a;
    const frequencies = new Map();
    for (const term of queryTerms) {
        let count = 0;
        for (const row of rows) {
            const haystack = `${row.content} ${(_a = row.summary) !== null && _a !== void 0 ? _a : ""}`.toLowerCase();
            if (haystack.includes(term)) {
                count += 1;
            }
        }
        frequencies.set(term, Math.max(count, 1));
    }
    return frequencies;
}
