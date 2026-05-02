/**
 * Streaming chat layer.
 *
 * `handleMessageStream` is an async generator that drives the existing
 * `runToolLoop` and emits structured events as they occur:
 *
 *   {type:'run', sessionId, runId, taskId} — emitted once when a runtime run starts
 *   {type:'token', text}         — one event per LLM response (full turn text)
 *   {type:'tool', name, args}    — emitted before each tool execution
 *   {type:'tool_result', name, result} — emitted after each tool execution
 *   {type:'final', text, usage?} — always last; text = stripped final answer
 *
 * Since our AI providers return `Promise<string>` (no native streaming),
 * each LLM turn produces exactly one `token` event carrying the full text of
 * that turn.  True character-by-character streaming can be wired in later by
 * replacing the `chat` function with one that chunks its output.
 */
import type { ChatFn, ToolExecFn, ToolLoopRunOptions, ToolLoopOptions } from './tool-loop';
import type { Message } from '../ai/providers/base';
import type { ToolDefinition, ToolContext } from './tools';
export interface OpenFile {
    path: string;
    content: string;
    language?: string;
}
export type StreamEvent = {
    type: 'run';
    sessionId: string;
    runId: string;
    taskId: string;
} | {
    type: 'token';
    text: string;
} | {
    type: 'tool';
    name: string;
    args: Record<string, unknown>;
} | {
    type: 'tool_result';
    name: string;
    result: unknown;
} | {
    type: 'final';
    text: string;
    usage?: {
        tokens?: number;
    };
};
export interface StreamOptions {
    /** AI chat function — same signature as `ChatFn` in tool-loop. */
    chat: ChatFn;
    /** Tool executor. Defaults to a no-op (no tools). */
    exec?: ToolExecFn;
    /** Tool definitions to expose to the model. */
    tools?: ToolDefinition[];
    /** Tool execution context (userId, sessionId, …). */
    toolCtx?: ToolContext;
    /** Provider / model selection forwarded to the loop. */
    runOpts?: ToolLoopRunOptions;
    /** Advanced loop options (maxIterations, timeouts, …). */
    loopOpts?: ToolLoopOptions;
}
/**
 * Builds a `<context_files>` XML block from the supplied open files.
 * Truncates combined content at 64 KB (in path order) and appends a marker.
 */
export declare function buildContextBlock(openFiles: OpenFile[]): string;
/**
 * Async generator that streams events from a tool-loop run.
 *
 * @param messages  Full conversation history including the new user message.
 * @param options   Chat function, exec function, tools, …
 */
export declare function handleMessageStream(messages: Message[], options: StreamOptions): AsyncGenerator<StreamEvent>;
//# sourceMappingURL=streaming.d.ts.map