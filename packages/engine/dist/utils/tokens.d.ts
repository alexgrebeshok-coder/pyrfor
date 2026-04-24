/**
 * Token estimation utilities — shared across runtime modules.
 *
 * Rough estimates based on character analysis:
 * - Russian/Cyrillic: ~1 token per 3.5 chars
 * - English/Latin:   ~1 token per 4.0 chars
 * - Mixed text:      weighted average
 *
 * NOTE: These are approximations. For accurate counts,
 * use tiktoken or the provider's own token counting API.
 */
/**
 * Estimate token count for a text string.
 * Handles mixed Cyrillic/Latin content.
 */
export declare function estimateTokens(text: string): number;
/**
 * Estimate total tokens for a message array (with role overhead).
 * Each message has ~4 tokens of role/formatting overhead.
 */
export declare function calculateMessageTokens(messages: Array<{
    content: string;
}>): number;
//# sourceMappingURL=tokens.d.ts.map