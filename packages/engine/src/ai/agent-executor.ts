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
import { executeToolCall } from './tool-executor';
import { getAIKernelToolDefinitions } from './kernel-tool-plane';
import { buildCostRecorder } from './cost-tracker';
import { logger } from '../observability/logger';
import type { Message } from './providers';
import type { AIToolCall, AIToolResult } from './tools';

// ============================================
// Types
// ============================================

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

// ============================================
// Safety guard
// ============================================

/** Dangerous tool names that require human approval in strict mode */
const MUTATION_TOOLS = new Set([
  "create_task",
  "update_task",
  "create_risk",
  "create_expense",
  "create_material_movement",
  "sync_1c",
]);

function isMutationTool(toolName: string): boolean {
  return MUTATION_TOOLS.has(toolName);
}

// ============================================
// Main executor
// ============================================

const MAX_TOOL_ROUNDS = 5;

export async function runAgentExecution(
  messages: Message[],
  options: AgentExecutorOptions
): Promise<ExecutorResult> {
  const {
    agentId,
    runId,
    workspaceId,
    router: injectedRouter,
    provider,
    model,
    maxToolRounds = MAX_TOOL_ROUNDS,
    signal,
    enableTools = false,
    safetyLevel = "strict",
    onStep,
  } = options;

  const startMs = Date.now();
  const router = injectedRouter ?? getRouter();
  let toolCallsMade = 0;
  let round = 0;
  let aborted = false;

  // Working message history — mutated across tool rounds
  const history: Message[] = [...messages];

  const recordCost = buildCostRecorder(
    provider || router.getAvailableProviders()[0] || "unknown",
    model || "unknown",
    messages,
    { agentId, runId, workspaceId }
  );

  let finalContent = "";

  try {
    while (round < maxToolRounds) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      round++;

      // Get tool definitions if tools enabled
      const toolDefs = enableTools ? getAIKernelToolDefinitions() : undefined;

      // Prefer native function calling when tools are enabled and the router
      // has at least one tool-capable provider registered. Falls back to text
      // chat with legacy JSON-parsing when no native path is available.
      let response = "";
      let toolCalls: AIToolCall[] = [];

      if (enableTools && toolDefs && router.hasToolCapableProvider()) {
        const structured = await router.chatWithTools(history, {
          provider,
          model,
          agentId,
          runId,
          workspaceId,
          tools: toolDefs,
          toolChoice: "auto",
        });
        response = structured.content;
        toolCalls = structured.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name as AIToolCall["function"]["name"],
            arguments: tc.function.arguments,
          },
        }));
      } else {
        response = await router.chat(history, {
          provider,
          model,
          agentId,
          runId,
          workspaceId,
        });
      }

      finalContent = response;
      recordCost(response);

      onStep?.({ type: "message", content: response, round });

      // No tools enabled — done
      if (!enableTools || !toolDefs) break;

      // If structured path returned no tool calls, try the legacy text parser
      // (some models still emit JSON in content even when tools=auto).
      if (toolCalls.length === 0) {
        const parsed = parseToolCallsFromResponse(response);
        if (parsed && parsed.length > 0) {
          toolCalls = parsed;
        }
      }

      if (!toolCalls || toolCalls.length === 0) break;

      // Safety check in strict mode
      if (safetyLevel === "strict") {
        const mutationCalls = toolCalls.filter((tc) => isMutationTool(tc.function.name));
        if (mutationCalls.length > 0) {
          logger.info("agent-executor: mutation tools blocked by safety guard", {
            agentId,
            runId,
            tools: mutationCalls.map((tc) => tc.function.name),
          });
          // Surface to caller as a proposal — don't execute
          onStep?.({
            type: "error",
            error: `Safety guard: mutation tools require human approval: ${mutationCalls.map((tc) => tc.function.name).join(", ")}`,
            round,
          });
          break;
        }
      }

      // Deduplicate identical tool calls emitted in the same round (some
      // providers produce duplicate function calls that otherwise multiply
      // side-effects and cost). Keyed by (name + normalized args).
      const seenTools = new Set<string>();
      const dedupedToolCalls: AIToolCall[] = [];
      for (const tc of toolCalls) {
        const key = `${tc.function.name}::${tc.function.arguments}`;
        if (seenTools.has(key)) continue;
        seenTools.add(key);
        dedupedToolCalls.push(tc);
      }

      if (signal?.aborted) {
        aborted = true;
        break;
      }

      // Execute tool calls in parallel within the round. Each call is
      // isolated through Promise.allSettled so one failing tool does not
      // abort the others, and we still record a structured result.
      for (const tc of dedupedToolCalls) {
        onStep?.({ type: "tool_call", toolCall: tc, round });
      }
      toolCallsMade += dedupedToolCalls.length;

      const settledResults = await Promise.allSettled(
        dedupedToolCalls.map((tc) => executeToolCall(tc))
      );

      const toolResults: AIToolResult[] = settledResults.map((outcome, index) => {
        const tc = dedupedToolCalls[index];
        if (outcome.status === "fulfilled") return outcome.value;
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        return {
          toolCallId: tc.id,
          name: tc.function.name as AIToolResult["name"],
          success: false,
          result: { error: message },
          displayMessage: `Tool ${tc.function.name} failed: ${message}`,
        } satisfies AIToolResult;
      });

      for (const result of toolResults) {
        onStep?.({ type: "tool_result", toolResult: result, round });
      }

      if (signal?.aborted) {
        aborted = true;
        break;
      }

      // Inject tool results into history for next round
      history.push({ role: "assistant", content: response });
      history.push({
        role: "user",
        content: formatToolResults(toolResults),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("agent-executor: execution error", { agentId, runId, error: msg });
    onStep?.({ type: "error", error: msg, round });
    if (!finalContent) finalContent = `Error: ${msg}`;
  }

  return {
    finalContent,
    toolCallsMade,
    rounds: round,
    durationMs: Date.now() - startMs,
    aborted,
  };
}

// ============================================
// Helpers
// ============================================

/**
 * Very simple tool-call parser.
 * Real implementations would use structured output from the LLM.
 * This handles the text-based function call format.
 */
export function parseToolCallsFromResponse(response: string): AIToolCall[] {
  let jsonStr: string | null = null;

  const codeMatch = response.match(/```(?:json|tool_calls?)?\s*([\s\S]*?)```/i);
  if (codeMatch?.[1]) {
    jsonStr = codeMatch[1].trim();
  }

  if (!jsonStr) {
    const start = response.lastIndexOf("[");
    const end = response.lastIndexOf("]");
    if (start !== -1 && end > start) {
      jsonStr = response.slice(start, end + 1);
    }
  }

  if (!jsonStr) {
    try {
      JSON.parse(response);
      jsonStr = response;
    } catch {
      jsonStr = null;
    }
  }

  if (!jsonStr) return [];

  try {
    const raw = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (tc): tc is AIToolCall =>
        typeof tc === "object" &&
        tc !== null &&
        typeof (tc as { id?: unknown }).id === "string" &&
        typeof (tc as { function?: unknown }).function === "object" &&
        (tc as { function?: unknown }).function !== null &&
        typeof (tc as { function: { name?: unknown } }).function.name === "string" &&
        typeof (tc as { function: { arguments?: unknown } }).function.arguments === "string"
    );
  } catch {
    return [];
  }
}

function formatToolResults(results: AIToolResult[]): string {
  if (results.length === 0) return "";
  const lines = results.map(
    (r) => `[Tool: ${r.name}] ${r.success ? "✓" : "✗"} ${JSON.stringify(r.result)}`
  );
  return `Tool results:\n${lines.join("\n")}`;
}
