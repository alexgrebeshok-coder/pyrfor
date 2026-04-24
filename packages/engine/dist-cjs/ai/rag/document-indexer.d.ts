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
export type DocumentType = "project_plan" | "status_report" | "meeting_notes" | "contract" | "specification" | "budget_report" | "risk_register" | "general";
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
export declare function chunkText(text: string): string[];
export declare function indexDocument(options: {
    title: string;
    content: string;
    type?: DocumentType;
    source?: string;
    projectId?: string;
    workspaceId?: string;
    metadata?: Record<string, unknown>;
}): Promise<string>;
export declare function searchDocuments(opts: RAGSearchOptions): Promise<RAGResult[]>;
/**
 * Build a RAG context string for injecting into agent prompts.
 */
export declare function buildRAGContext(query: string, options?: {
    projectId?: string;
    workspaceId?: string;
    limit?: number;
}): Promise<string>;
//# sourceMappingURL=document-indexer.d.ts.map