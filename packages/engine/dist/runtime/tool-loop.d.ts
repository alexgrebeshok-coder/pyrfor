/**
 * Tool Calling Loop — provider-agnostic ReAct-style tool execution.
 *
 * Why prompt-based (not native function-calling)?
 * Our `AIProvider.chat()` returns `string` and doesn't expose structured
 * tool-call responses. To support tools across all 7 providers (Zhipu, ZAI,
 * OpenRouter, OpenAI, GigaChat, YandexGPT, Ollama) without overhauling each,
 * we describe tools in the system prompt and parse `<tool_call>...</tool_call>`
 * blocks from the assistant text.
 *
 * Loop:
 *   1. Inject tool instructions into messages
 *   2. Call provider → get assistant text
 *   3. Parse tool calls; if none → return final text
 *   4. Execute each tool call → append result as a user message
 *   5. Repeat until no tool calls or max iterations reached
 */
import type { Message } from '../ai/providers/base';
import type { ToolDefinition, ToolContext, ToolResult } from './tools';
export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
    raw: string;
}
export interface ToolLoopOptions {
    maxIterations?: number;
    /** Soft cap on serialized tool result size before truncation. */
    maxResultChars?: number;
}
export interface ToolLoopRunOptions {
    provider?: string;
    model?: string;
    sessionId?: string;
}
export type ChatFn = (messages: Message[], options?: ToolLoopRunOptions) => Promise<string>;
export type ToolExecFn = (name: string, args: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>;
export interface ToolLoopResult {
    /** Final assistant text with tool blocks stripped. */
    finalText: string;
    /** All assistant turns (with tool blocks) appended during the loop. */
    assistantTurns: string[];
    /** Tool calls executed, in order. */
    toolCalls: Array<{
        call: ToolCall;
        result: ToolResult;
    }>;
    /** True if we hit the iteration cap without a clean final text. */
    truncated: boolean;
    iterations: number;
}
/**
 * Build the prompt fragment that teaches the model how to invoke tools.
 */
export declare function buildToolInstructions(tools: ToolDefinition[]): string;
/**
 * Parse zero or more tool calls from assistant text.
 * Robust against minor JSON noise (trailing commas, single quotes), against
 * models that forget to emit `</tool_call>`, and against GLM-style
 * `<tool_call={json}>` shapes where the JSON is embedded in the opening tag.
 */
export declare function parseToolCalls(text: string): ToolCall[];
/** Strip every `<tool_call ...>` block from text (all known shapes). */
export declare function stripToolCalls(text: string): string;
/**
 * Run the tool calling loop.
 *
 * Strategy:
 *   - Inject tool instructions into the system message (or prepend a system msg).
 *   - On each turn, ask the model. If it emits tool calls, run them, append a
 *     user-role message with the results, and ask again.
 *   - Stop when the model returns text with no tool calls, or after maxIter.
 */
export declare function runToolLoop(messages: Message[], tools: ToolDefinition[], chat: ChatFn, exec: ToolExecFn, toolCtx: ToolContext | undefined, runOpts?: ToolLoopRunOptions, loopOpts?: ToolLoopOptions): Promise<ToolLoopResult>;
//# sourceMappingURL=tool-loop.d.ts.map