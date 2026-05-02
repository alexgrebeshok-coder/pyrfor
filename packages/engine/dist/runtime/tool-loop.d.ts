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
export type ApprovalDecision = 'approve' | 'deny' | 'timeout';
export interface ApprovalRequest {
    id: string;
    toolName: string;
    summary: string;
    args: Record<string, unknown>;
}
/** Injectable approval gate. Return 'approve' to proceed, anything else to deny. */
export type ApprovalGate = (req: ApprovalRequest) => Promise<ApprovalDecision>;
export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
    raw: string;
}
export type ProgressEvent = {
    kind: 'tool-start';
    name: string;
    summary: string;
} | {
    kind: 'tool-end';
    name: string;
    ok: boolean;
    ms: number;
} | {
    kind: 'llm-start';
    model: string;
} | {
    kind: 'llm-end';
    model: string;
    ms: number;
} | {
    kind: 'compact';
    tokensBefore: number;
    tokensAfter: number;
};
export interface ToolLoopOptions {
    maxIterations?: number;
    /** Soft cap on serialized tool result size before truncation. */
    maxResultChars?: number;
    /** Per-tool-call timeout in ms (default: 60_000). */
    toolTimeoutMs?: number;
    /** Per-tool-name timeout overrides; takes priority over toolTimeoutMs. */
    toolTimeoutsMs?: Record<string, number>;
    /** AbortSignal to cancel the loop externally between iterations or during tool calls. */
    signal?: AbortSignal;
    /**
     * Injectable approval gate — called before each tool execution.
     * Resolve 'approve' to proceed, 'deny' or 'timeout' to skip execution.
     * Defaults to undefined (= unconditional approve) so existing tests pass unchanged.
     */
    approvalGate?: ApprovalGate;
    /** Optional progress callback invoked at key lifecycle points. */
    onProgress?: (event: ProgressEvent) => void;
    onToolAudit?: (event: {
        requestId: string;
        toolName: string;
        summary: string;
        args: Record<string, unknown>;
        decision?: ApprovalDecision;
        sessionId?: string;
        toolCallId?: string;
        resultSummary?: string;
        error?: string;
        undo?: {
            supported: boolean;
            kind?: string;
        };
    }) => void;
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
    /** True if the loop was stopped early by an AbortSignal. */
    stopped?: boolean;
    /** Human-readable reason for an early stop (e.g., 'aborted'). */
    reason?: string;
}
/** Hard safety cap — no call may exceed this iteration count regardless of caller value. */
export declare const SAFETY_HARD_CAP = 100;
/**
 * Build the prompt fragment that teaches the model how to invoke tools.
 */
export declare function buildToolInstructions(tools: ToolDefinition[]): string;
/**
 * Parse zero or more tool calls from assistant text.
 * Delegates to the universal tool-call-parser module.
 * For backward compatibility, only the original `<tool_call>` tagged strategy
 * and arg-xml strategy are enabled. Other strategies can be enabled via ParseOptions
 * if the caller imports parseToolCalls directly from tool-call-parser.ts.
 */
export declare function parseToolCalls(text: string): ToolCall[];
/** Strip every tool-call block from text (all known shapes). */
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