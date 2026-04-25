/**
 * Document processing module for Pyrfor engine.
 * Parses PDF/DOCX/XLSX/PPTX into markdown-ish text.
 */
export interface DocumentInput {
    buffer: Buffer;
    filename: string;
    mimeType?: string;
}
export interface DocumentProcessResult {
    enrichedPrompt: string;
    extractedTextLength: number;
    format: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'unknown';
    truncated: boolean;
}
/**
 * Main document processing function.
 */
export declare function processDocument(input: DocumentInput): Promise<DocumentProcessResult>;
//# sourceMappingURL=process-document.d.ts.map