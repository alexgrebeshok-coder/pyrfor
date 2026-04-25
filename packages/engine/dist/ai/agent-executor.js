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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "server-only";
import { getRouter } from './providers.js';
import { executeToolCall } from './tool-executor.js';
import { getAIKernelToolDefinitions } from './kernel-tool-plane.js';
import { buildCostRecorder } from './cost-tracker.js';
import { logger } from '../observability/logger.js';
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
function isMutationTool(toolName) {
    return MUTATION_TOOLS.has(toolName);
}
// ============================================
// Main executor
// ============================================
const MAX_TOOL_ROUNDS = 5;
export function runAgentExecution(messages, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { agentId, runId, workspaceId, router: injectedRouter, provider, model, maxToolRounds = MAX_TOOL_ROUNDS, signal, enableTools = false, safetyLevel = "strict", onStep, } = options;
        const startMs = Date.now();
        const router = injectedRouter !== null && injectedRouter !== void 0 ? injectedRouter : getRouter();
        let toolCallsMade = 0;
        let round = 0;
        let aborted = false;
        // Working message history — mutated across tool rounds
        const history = [...messages];
        const recordCost = buildCostRecorder(provider || router.getAvailableProviders()[0] || "unknown", model || "unknown", messages, { agentId, runId, workspaceId });
        let finalContent = "";
        try {
            while (round < maxToolRounds) {
                if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
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
                let toolCalls = [];
                if (enableTools && toolDefs && router.hasToolCapableProvider()) {
                    const structured = yield router.chatWithTools(history, {
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
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    }));
                }
                else {
                    response = yield router.chat(history, {
                        provider,
                        model,
                        agentId,
                        runId,
                        workspaceId,
                    });
                }
                finalContent = response;
                recordCost(response);
                onStep === null || onStep === void 0 ? void 0 : onStep({ type: "message", content: response, round });
                // No tools enabled — done
                if (!enableTools || !toolDefs)
                    break;
                // If structured path returned no tool calls, try the legacy text parser
                // (some models still emit JSON in content even when tools=auto).
                if (toolCalls.length === 0) {
                    const parsed = parseToolCallsFromResponse(response);
                    if (parsed && parsed.length > 0) {
                        toolCalls = parsed;
                    }
                }
                if (!toolCalls || toolCalls.length === 0)
                    break;
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
                        onStep === null || onStep === void 0 ? void 0 : onStep({
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
                const seenTools = new Set();
                const dedupedToolCalls = [];
                for (const tc of toolCalls) {
                    const key = `${tc.function.name}::${tc.function.arguments}`;
                    if (seenTools.has(key))
                        continue;
                    seenTools.add(key);
                    dedupedToolCalls.push(tc);
                }
                if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                    aborted = true;
                    break;
                }
                // Execute tool calls in parallel within the round. Each call is
                // isolated through Promise.allSettled so one failing tool does not
                // abort the others, and we still record a structured result.
                for (const tc of dedupedToolCalls) {
                    onStep === null || onStep === void 0 ? void 0 : onStep({ type: "tool_call", toolCall: tc, round });
                }
                toolCallsMade += dedupedToolCalls.length;
                const settledResults = yield Promise.allSettled(dedupedToolCalls.map((tc) => executeToolCall(tc)));
                const toolResults = settledResults.map((outcome, index) => {
                    const tc = dedupedToolCalls[index];
                    if (outcome.status === "fulfilled")
                        return outcome.value;
                    const message = outcome.reason instanceof Error
                        ? outcome.reason.message
                        : String(outcome.reason);
                    return {
                        toolCallId: tc.id,
                        name: tc.function.name,
                        success: false,
                        result: { error: message },
                        displayMessage: `Tool ${tc.function.name} failed: ${message}`,
                    };
                });
                for (const result of toolResults) {
                    onStep === null || onStep === void 0 ? void 0 : onStep({ type: "tool_result", toolResult: result, round });
                }
                if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("agent-executor: execution error", { agentId, runId, error: msg });
            onStep === null || onStep === void 0 ? void 0 : onStep({ type: "error", error: msg, round });
            if (!finalContent)
                finalContent = `Error: ${msg}`;
        }
        return {
            finalContent,
            toolCallsMade,
            rounds: round,
            durationMs: Date.now() - startMs,
            aborted,
        };
    });
}
// ============================================
// Helpers
// ============================================
/**
 * Very simple tool-call parser.
 * Real implementations would use structured output from the LLM.
 * This handles the text-based function call format.
 */
export function parseToolCallsFromResponse(response) {
    let jsonStr = null;
    const codeMatch = response.match(/```(?:json|tool_calls?)?\s*([\s\S]*?)```/i);
    if (codeMatch === null || codeMatch === void 0 ? void 0 : codeMatch[1]) {
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
        }
        catch (_a) {
            jsonStr = null;
        }
    }
    if (!jsonStr)
        return [];
    try {
        const raw = JSON.parse(jsonStr);
        if (!Array.isArray(raw))
            return [];
        return raw.filter((tc) => typeof tc === "object" &&
            tc !== null &&
            typeof tc.id === "string" &&
            typeof tc.function === "object" &&
            tc.function !== null &&
            typeof tc.function.name === "string" &&
            typeof tc.function.arguments === "string");
    }
    catch (_b) {
        return [];
    }
}
function formatToolResults(results) {
    if (results.length === 0)
        return "";
    const lines = results.map((r) => `[Tool: ${r.name}] ${r.success ? "✓" : "✗"} ${JSON.stringify(r.result)}`);
    return `Tool results:\n${lines.join("\n")}`;
}
