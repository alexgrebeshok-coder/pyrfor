/**
 * Telegram-safe markdown sanitizer + chunker.
 * Prevents parse_mode 400 errors when forwarding LLM output to Telegram.
 */
export type SanitizeOpts = {
    mode: 'markdownv2' | 'html' | 'plain';
    preserveCodeBlocks?: boolean;
    maxLen?: number;
    chunkSeparator?: string;
};
export type SanitizeResult = {
    mode: SanitizeOpts['mode'];
    chunks: string[];
    truncated: boolean;
};
/**
 * Escape all Telegram MarkdownV2 special characters in plain text.
 * Does NOT double-escape already-escaped sequences.
 */
export declare function escapeMarkdownV2(text: string): string;
/**
 * Escape HTML special characters outside safe blocks.
 */
export declare function escapeHtml(text: string): string;
export declare function sanitize(text: string, opts: SanitizeOpts): SanitizeResult;
//# sourceMappingURL=markdown-sanitizer.d.ts.map