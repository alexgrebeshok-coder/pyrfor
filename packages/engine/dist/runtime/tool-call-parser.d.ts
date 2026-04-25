/**
 * tool-call-parser.ts — Universal LLM tool-call parser for Pyrfor engine.
 *
 * Extracts structured tool calls from diverse LLM output formats:
 *   - Tagged <tool_call> (4 shapes: standard, unclosed, GLM-style, GLM-redundant)
 *   - Custom arg-key/arg-value XML inside <tool_call> (production bug fix)
 *   - Anthropic <function_call> and <tool_use> tags
 *   - OpenAI native tool_calls array (double-encoded arguments)
 *   - Bare JSON objects {"name":"X","args":{...}}
 *   - Plain text key:value lines (conservative fallback)
 *
 * Strategy pipeline tries formats in priority order, accumulating results.
 * Robust against malformed JSON (repairs unquoted keys, single quotes).
 * Pure TS, ESM-only, no external deps.
 */
export interface ParsedToolCall {
    name: string;
    args: Record<string, unknown>;
    /** Verbatim source slice that produced this call. */
    raw: string;
}
export interface ParseOptions {
    /** Optional callback fired for every failed parse attempt with diagnostic info. Default: logger.warn */
    onParseFailure?: (info: {
        strategy: string;
        rawPreview: string;
        error: string;
    }) => void;
    /** Disable specific strategies (for testing isolation). */
    disableStrategies?: Array<'tagged' | 'arg-xml' | 'function-call-tag' | 'openai-native' | 'bare-object' | 'line-kv'>;
}
/**
 * Extract the first balanced `{...}` object from a string, ignoring text
 * after it. Returns null if no balanced object found.
 * String-aware: skips braces inside quoted strings.
 */
export declare function extractFirstJsonObject(s: string): string | null;
export declare function parseToolCalls(text: string, opts?: ParseOptions): ParsedToolCall[];
export declare function stripToolCalls(text: string): string;
//# sourceMappingURL=tool-call-parser.d.ts.map