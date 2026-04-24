"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
exports.calculateMessageTokens = calculateMessageTokens;
/**
 * Estimate token count for a text string.
 * Handles mixed Cyrillic/Latin content.
 */
function estimateTokens(text) {
    if (!text)
        return 0;
    const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const totalChars = text.length;
    const latinCount = totalChars - cyrillicCount;
    return Math.ceil(cyrillicCount / 3.5 + latinCount / 4);
}
/**
 * Estimate total tokens for a message array (with role overhead).
 * Each message has ~4 tokens of role/formatting overhead.
 */
function calculateMessageTokens(messages) {
    return messages.reduce((total, msg) => total + 4 + estimateTokens(msg.content), 0);
}
