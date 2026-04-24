/**
 * RAG (Retrieval-Augmented Generation) — Document Indexer
 *
 * Indexes project documents (plans, reports, contracts, meeting notes)
 * and retrieves relevant chunks to inject into agent context.
 *
 * Storage: Prisma ProjectDocument table (JSON-backed for now).
 * Retrieval: keyword BM25-style scoring — upgrade to pgvector when available.
 * Chunking: fixed-size with overlap (512 chars, 128 overlap).
 *
 * Supports: .txt, .md, .json (project export), inline text
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
import { logger } from '../../observability/logger';
// ============================================
// Chunking
// ============================================
const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 128;
export function chunkText(text) {
    const chunks = [];
    let pos = 0;
    while (pos < text.length) {
        const end = Math.min(pos + CHUNK_SIZE, text.length);
        chunks.push(text.slice(pos, end));
        pos += CHUNK_SIZE - CHUNK_OVERLAP;
        if (pos >= text.length)
            break;
    }
    return chunks;
}
// ============================================
// BM25-style scoring
// ============================================
function scoreChunk(chunk, queryTerms) {
    if (queryTerms.length === 0)
        return 0;
    const lc = chunk.toLowerCase();
    return queryTerms.reduce((acc, term) => {
        var _a;
        const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        const count = ((_a = lc.match(re)) !== null && _a !== void 0 ? _a : []).length;
        return acc + Math.log1p(count) * (1 / queryTerms.length);
    }, 0);
}
// ============================================
// Document indexer
// ============================================
export function indexDocument(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const chunks = chunkText(options.content);
        const docType = (_a = options.type) !== null && _a !== void 0 ? _a : "general";
        try {
            const { prisma } = yield import('../../prisma');
            const doc = yield prisma.projectDocument.create({
                data: {
                    title: options.title,
                    type: docType,
                    source: (_b = options.source) !== null && _b !== void 0 ? _b : "inline",
                    projectId: options.projectId,
                    workspaceId: options.workspaceId,
                    chunkCount: chunks.length,
                    fullText: options.content.slice(0, 50000), // limit stored text
                    metadata: JSON.stringify((_c = options.metadata) !== null && _c !== void 0 ? _c : {}),
                    chunks: {
                        create: chunks.map((chunk, index) => ({
                            chunkIndex: index,
                            content: chunk,
                        })),
                    },
                },
            });
            logger.info("rag: document indexed", {
                id: doc.id,
                title: options.title,
                chunks: chunks.length,
            });
            return doc.id;
        }
        catch (err) {
            logger.error("rag: indexing failed", {
                title: options.title,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    });
}
// ============================================
// Retrieval
// ============================================
export function searchDocuments(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const limit = (_a = opts.limit) !== null && _a !== void 0 ? _a : 5;
        const queryTerms = opts.query
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length > 2);
        try {
            const { prisma } = yield import('../../prisma');
            // Fetch chunks from matching documents
            const chunks = yield prisma.projectDocumentChunk.findMany({
                where: {
                    document: Object.assign(Object.assign(Object.assign({}, (opts.projectId && { projectId: opts.projectId })), (opts.workspaceId && { workspaceId: opts.workspaceId })), (opts.type && { type: opts.type })),
                },
                include: {
                    document: {
                        select: { id: true, title: true, type: true },
                    },
                },
                take: limit * 10, // over-fetch for client scoring
            });
            const scored = chunks
                .map((c) => ({
                documentTitle: c.document.title,
                documentType: c.document.type,
                chunk: c.content,
                score: scoreChunk(c.content, queryTerms),
                documentId: c.document.id,
            }))
                .filter((r) => r.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
            return scored;
        }
        catch (err) {
            logger.warn("rag: search failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return [];
        }
    });
}
/**
 * Build a RAG context string for injecting into agent prompts.
 */
export function buildRAGContext(query_1) {
    return __awaiter(this, arguments, void 0, function* (query, options = {}) {
        var _a;
        const results = yield searchDocuments({
            query,
            projectId: options.projectId,
            workspaceId: options.workspaceId,
            limit: (_a = options.limit) !== null && _a !== void 0 ? _a : 3,
        });
        if (results.length === 0)
            return "";
        const lines = results.map((r) => `### ${r.documentTitle} (${r.documentType})\n${r.chunk}`);
        return `## Relevant project documents:\n\n${lines.join("\n\n---\n\n")}`;
    });
}
