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

import { logger } from "@/lib/logger";

// ============================================
// Types
// ============================================

export type DocumentType =
  | "project_plan"
  | "status_report"
  | "meeting_notes"
  | "contract"
  | "specification"
  | "budget_report"
  | "risk_register"
  | "general";

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedDocument {
  id: string;
  title: string;
  type: DocumentType;
  source: string;
  projectId?: string;
  workspaceId?: string;
  chunkCount: number;
  createdAt: Date;
}

export interface RAGSearchOptions {
  query: string;
  projectId?: string;
  workspaceId?: string;
  type?: DocumentType;
  limit?: number;
}

export interface RAGResult {
  documentTitle: string;
  documentType: DocumentType;
  chunk: string;
  score: number;
  documentId: string;
}

// ============================================
// Chunking
// ============================================

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 128;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + CHUNK_SIZE, text.length);
    chunks.push(text.slice(pos, end));
    pos += CHUNK_SIZE - CHUNK_OVERLAP;
    if (pos >= text.length) break;
  }

  return chunks;
}

// ============================================
// BM25-style scoring
// ============================================

function scoreChunk(chunk: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
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

export async function indexDocument(options: {
  title: string;
  content: string;
  type?: DocumentType;
  source?: string;
  projectId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const chunks = chunkText(options.content);
  const docType = options.type ?? "general";

  try {
    const { prisma } = await import("@/lib/prisma");

    const doc = await (prisma as any).projectDocument.create({
      data: {
        title: options.title,
        type: docType,
        source: options.source ?? "inline",
        projectId: options.projectId,
        workspaceId: options.workspaceId,
        chunkCount: chunks.length,
        fullText: options.content.slice(0, 50_000), // limit stored text
        metadata: JSON.stringify(options.metadata ?? {}),
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

    return doc.id as string;
  } catch (err) {
    logger.error("rag: indexing failed", {
      title: options.title,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ============================================
// Retrieval
// ============================================

export async function searchDocuments(opts: RAGSearchOptions): Promise<RAGResult[]> {
  const limit = opts.limit ?? 5;
  const queryTerms = opts.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  try {
    const { prisma } = await import("@/lib/prisma");

    // Fetch chunks from matching documents
    const chunks: Array<{
      id: string;
      content: string;
      chunkIndex: number;
      document: {
        id: string;
        title: string;
        type: string;
      };
    }> = await (prisma as any).projectDocumentChunk.findMany({
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
        documentType: c.document.type as DocumentType,
        chunk: c.content,
        score: scoreChunk(c.content, queryTerms),
        documentId: c.document.id,
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  } catch (err) {
    logger.warn("rag: search failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build a RAG context string for injecting into agent prompts.
 */
export async function buildRAGContext(
  query: string,
  options: { projectId?: string; workspaceId?: string; limit?: number } = {}
): Promise<string> {
  const results = await searchDocuments({
    query,
    projectId: options.projectId,
    workspaceId: options.workspaceId,
    limit: options.limit ?? 3,
  });

  if (results.length === 0) return "";

  const lines = results.map(
    (r) => `### ${r.documentTitle} (${r.documentType})\n${r.chunk}`
  );
  return `## Relevant project documents:\n\n${lines.join("\n\n---\n\n")}`;
}
