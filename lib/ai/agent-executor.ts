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

import { getRouter } from "@/lib/ai/providers";
import { executeToolCall } from "@/lib/ai/tool-executor";
import { getAIKernelToolDefinitions } from "@/lib/ai/kernel-tool-plane";
import { buildCostRecorder } from "@/lib/ai/cost-tracker";
import { logger } from "@/lib/logger";
import type { Message } from "@/lib/ai/providers";
import type { AIToolCall, AIToolResult } from "@/lib/ai/tools";

// ============================================
// Types
// ============================================

export interface AgentExecutorOptions {
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
    provider,
    model,
    maxToolRounds = MAX_TOOL_ROUNDS,
    signal,
    enableTools = false,
    safetyLevel = "strict",
    onStep,
  } = options;

  const startMs = Date.now();
  const router = getRouter();
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

      // Call AI
      const response = await router.chat(history, {
        provider,
        model,
        agentId,
        runId,
        workspaceId,
      });

      finalContent = response;
      recordCost(response);

      onStep?.({ type: "message", content: response, round });

      // No tools enabled or response has no tool calls — done
      if (!enableTools || !toolDefs) break;

      // Parse tool calls from response (simplified: check for JSON tool call patterns)
      const toolCalls = parseToolCallsFromResponse(response);
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

      // Execute each tool call
      const toolResults: AIToolResult[] = [];
      for (const tc of toolCalls) {
        if (signal?.aborted) { aborted = true; break; }

        onStep?.({ type: "tool_call", toolCall: tc, round });
        toolCallsMade++;

        const result = await executeToolCall(tc);
        toolResults.push(result);
        onStep?.({ type: "tool_result", toolResult: result, round });
      }

      if (aborted) break;

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
function parseToolCallsFromResponse(response: string): AIToolCall[] {
  // Pattern: ```tool_calls\n[...json...]\n```
  const match = response.match(/```tool_calls?\s*([\s\S]*?)```/i);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1]);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (tc): tc is AIToolCall =>
        typeof tc.id === "string" &&
        typeof tc.function?.name === "string" &&
        typeof tc.function?.arguments === "string"
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
