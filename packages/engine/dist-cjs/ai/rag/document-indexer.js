"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
exports.indexDocument = indexDocument;
exports.searchDocuments = searchDocuments;
exports.buildRAGContext = buildRAGContext;
const logger_1 = require("../../observability/logger");
// ============================================
// Chunking
// ============================================
const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 128;
function chunkText(text) {
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
        const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        const count = (lc.match(re) ?? []).length;
        return acc + Math.log1p(count) * (1 / queryTerms.length);
    }, 0);
}
// ============================================
// Document indexer
// ============================================
async function indexDocument(options) {
    const chunks = chunkText(options.content);
    const docType = options.type ?? "general";
    try {
        const { prisma } = await Promise.resolve().then(() => __importStar(require('../../prisma')));
        const doc = await prisma.projectDocument.create({
            data: {
                title: options.title,
                type: docType,
                source: options.source ?? "inline",
                projectId: options.projectId,
                workspaceId: options.workspaceId,
                chunkCount: chunks.length,
                fullText: options.content.slice(0, 50000), // limit stored text
                metadata: JSON.stringify(options.metadata ?? {}),
                chunks: {
                    create: chunks.map((chunk, index) => ({
                        chunkIndex: index,
                        content: chunk,
                    })),
                },
            },
        });
        logger_1.logger.info("rag: document indexed", {
            id: doc.id,
            title: options.title,
            chunks: chunks.length,
        });
        return doc.id;
    }
    catch (err) {
        logger_1.logger.error("rag: indexing failed", {
            title: options.title,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
// ============================================
// Retrieval
// ============================================
async function searchDocuments(opts) {
    const limit = opts.limit ?? 5;
    const queryTerms = opts.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);
    try {
        const { prisma } = await Promise.resolve().then(() => __importStar(require('../../prisma')));
        // Fetch chunks from matching documents
        const chunks = await prisma.projectDocumentChunk.findMany({
            where: {
                document: {
                    ...(opts.projectId && { projectId: opts.projectId }),
                    ...(opts.workspaceId && { workspaceId: opts.workspaceId }),
                    ...(opts.type && { type: opts.type }),
                },
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
        logger_1.logger.warn("rag: search failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
/**
 * Build a RAG context string for injecting into agent prompts.
 */
async function buildRAGContext(query, options = {}) {
    const results = await searchDocuments({
        query,
        projectId: options.projectId,
        workspaceId: options.workspaceId,
        limit: options.limit ?? 3,
    });
    if (results.length === 0)
        return "";
    const lines = results.map((r) => `### ${r.documentTitle} (${r.documentType})\n${r.chunk}`);
    return `## Relevant project documents:\n\n${lines.join("\n\n---\n\n")}`;
}
