/**
 * Agent Executor
 *
 * Orchestrates a single agent run with:
 * - Safety pre-check (blocks dangerous operations before execution)
 * - Multi-turn function calling loop (up to MAX_TOOL_ROUNDS)
 * - Tool result injection back into context
 * - Execution telemetry (tokens, cost, duration)
 * - Graceful abort via AbortSignal
 *
 * This is the execution spine that AgentRuntime delegates to.
 */
import "server-only";
import { getRouter } from './providers';
import type { Message } from './providers';
import type { AIToolCall, AIToolResult } from './tools';
export interface AgentExecutorOptions {
    /** Optional injected router for tests and custom runtimes */
    router?: ReturnType<typeof getRouter>;
    /** Which AI provider to use */
    provider?: string;
    /** Override model */
    model?: string;
    /** Agent identifier (for cost + logging) */
    agentId: string;
    /** Run identifier */
    runId: string;
    /** Workspace for cost attribution */
    workspaceId?: string;
    /** Maximum tool-call rounds before giving up (default: 5) */
    maxToolRounds?: number;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Whether tools are enabled for this run */
    enableTools?: boolean;
    /** Safety level — "strict" requires human approval for mutations, "permissive" auto-executes */
    safetyLevel?: "strict" | "permissive";
    /** Called after each assistant message */
    onStep?: (step: ExecutorStep) => void;
}
export interface ExecutorStep {
    type: "message" | "tool_call" | "tool_result" | "error";
    content?: string;
    toolCall?: AIToolCall;
    toolResult?: AIToolResult;
    error?: string;
    round: number;
}
export interface ExecutorResult {
    finalContent: string;
    toolCallsMade: number;
    rounds: number;
    durationMs: number;
    aborted: boolean;
}
export declare function runAgentExecution(messages: Message[], options: AgentExecutorOptions): Promise<ExecutorResult>;
/**
 * Very simple tool-call parser.
 * Real implementations would use structured output from the LLM.
 * This handles the text-based function call format.
 */
export declare function parseToolCallsFromResponse(response: string): AIToolCall[];
//# sourceMappingURL=agent-executor.d.ts.map