/**
 * Heartbeat Executor — bridges HeartbeatRun → existing agent execution engine
 *
 * Flow:
 * 1. Dequeue AgentWakeupRequest (or accept direct trigger)
 * 2. Create or attach to a HeartbeatRun record (status: queued → running)
 * 3. Resolve agent definition → build system prompt
 * 4. Execute via `runAgentExecution` kernel (tool calls, cost tracking,
 *    circuit breakers, workspace attribution) with an in-file retry /
 *    fallback / timeout shim. Wave F migrated this away from the
 *    deprecated `ImprovedAgentExecutor`.
 * 5. Record events, update HeartbeatRun (succeeded/failed), update RuntimeState
 * 6. Track cost via existing AIRunCost
 * 7. Broadcast SSE events for live UI updates
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
import { prisma } from '../prisma.js';
import { aiAgents } from '../ai/agents.js';
import { broadcastSSE } from '../transport/sse.js';
import { logger } from '../observability/logger.js';
import { runAgentExecution } from '../ai/agent-executor.js';
import { getRouter } from '../ai/providers.js';
import { sendHeartbeatTelegramNotification, sendBudgetWarningTelegram } from "./telegram-notify.js";
import { getAdapter } from "./adapters.js";
import { resolveSecretRefs } from "./agent-secrets.js";
import { getErrorMessage } from "./error-utils.js";
import { applyWakeupFailure, classifyOrchestrationFailure, } from "./retry-policy-service.js";
import { AgentCircuitOpenError, ensureAgentCircuitReady, recordAgentCircuitFailure, recordAgentCircuitSuccess, } from "./circuit-breaker-service.js";
import { createHeartbeatRunCheckpoint } from "./checkpoint-service.js";
import { syncWorkflowStepFromHeartbeatRun } from "./workflow-service.js";
// ── Event logger ───────────────────────────────────────────
function addRunEvent(runId, type, content, seq) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.heartbeatRunEvent.create({
            data: { runId, seq, type, content },
        });
    });
}
// ── Budget check ───────────────────────────────────────────
export function checkBudget(agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = yield prisma.agent.findUnique({
            where: { id: agentId },
            select: { budgetMonthlyCents: true, spentMonthlyCents: true },
        });
        if (!agent)
            return { ok: false, spent: 0, budget: 0 };
        if (agent.budgetMonthlyCents === 0)
            return { ok: true, spent: agent.spentMonthlyCents, budget: 0 };
        return {
            ok: agent.spentMonthlyCents < agent.budgetMonthlyCents,
            spent: agent.spentMonthlyCents,
            budget: agent.budgetMonthlyCents,
        };
    });
}
// ── Runtime State update ───────────────────────────────────
function updateRuntimeState(agentId, update) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        const existing = yield prisma.agentRuntimeState.findUnique({
            where: { agentId },
        });
        const data = {
            agentId,
            lastHeartbeatAt: new Date(),
            lastRunId: (_b = (_a = update.runId) !== null && _a !== void 0 ? _a : existing === null || existing === void 0 ? void 0 : existing.lastRunId) !== null && _b !== void 0 ? _b : null,
            lastError: (_c = update.error) !== null && _c !== void 0 ? _c : null,
            totalRuns: ((_d = existing === null || existing === void 0 ? void 0 : existing.totalRuns) !== null && _d !== void 0 ? _d : 0) + (update.status === "succeeded" || update.status === "failed" ? 1 : 0),
            successfulRuns: ((_e = existing === null || existing === void 0 ? void 0 : existing.successfulRuns) !== null && _e !== void 0 ? _e : 0) +
                (update.status === "succeeded" ? 1 : 0),
            totalTokens: ((_f = existing === null || existing === void 0 ? void 0 : existing.totalTokens) !== null && _f !== void 0 ? _f : 0) + ((_g = update.tokens) !== null && _g !== void 0 ? _g : 0),
            totalCostCents: ((_h = existing === null || existing === void 0 ? void 0 : existing.totalCostCents) !== null && _h !== void 0 ? _h : 0) + ((_j = update.costCents) !== null && _j !== void 0 ? _j : 0),
            consecutiveFailures: (_l = (_k = update.consecutiveFailures) !== null && _k !== void 0 ? _k : existing === null || existing === void 0 ? void 0 : existing.consecutiveFailures) !== null && _l !== void 0 ? _l : 0,
            circuitState: (_o = (_m = update.circuitState) !== null && _m !== void 0 ? _m : existing === null || existing === void 0 ? void 0 : existing.circuitState) !== null && _o !== void 0 ? _o : "closed",
            circuitOpenedAt: (_q = (_p = update.circuitOpenedAt) !== null && _p !== void 0 ? _p : existing === null || existing === void 0 ? void 0 : existing.circuitOpenedAt) !== null && _q !== void 0 ? _q : null,
            circuitOpenUntil: (_s = (_r = update.circuitOpenUntil) !== null && _r !== void 0 ? _r : existing === null || existing === void 0 ? void 0 : existing.circuitOpenUntil) !== null && _s !== void 0 ? _s : null,
        };
        yield prisma.agentRuntimeState.upsert({
            where: { agentId },
            create: data,
            update: {
                lastHeartbeatAt: data.lastHeartbeatAt,
                lastRunId: data.lastRunId,
                lastError: data.lastError,
                totalRuns: data.totalRuns,
                successfulRuns: data.successfulRuns,
                totalTokens: data.totalTokens,
                totalCostCents: data.totalCostCents,
                consecutiveFailures: data.consecutiveFailures,
                circuitState: data.circuitState,
                circuitOpenedAt: data.circuitOpenedAt,
                circuitOpenUntil: data.circuitOpenUntil,
            },
        });
    });
}
// ── Agent status transitions ───────────────────────────────
function setAgentStatus(agentId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.agent.update({
            where: { id: agentId },
            data: { status },
        });
    });
}
// ── Build agent prompt ─────────────────────────────────────
function buildAgentPrompt(agent, task) {
    const definition = agent.definitionId
        ? aiAgents.find((d) => d.id === agent.definitionId)
        : null;
    const runtimeConfig = parseRuntimeConfig(agent.runtimeConfig);
    const parts = [];
    if (runtimeConfig.systemPromptPrefix) {
        parts.push(runtimeConfig.systemPromptPrefix);
    }
    if (definition) {
        parts.push(`You are ${agent.name}, role: ${agent.role}.`, `Agent type: ${definition.id}, category: ${definition.category}`);
    }
    else {
        parts.push(`You are ${agent.name}, role: ${agent.role}.`);
    }
    if (runtimeConfig.systemPromptSuffix) {
        parts.push(runtimeConfig.systemPromptSuffix);
    }
    if (task) {
        parts.push("", "Current task:", task);
    }
    return parts.join("\n");
}
function parseRuntimeConfig(raw) {
    try {
        const parsed = JSON.parse(raw || "{}");
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    }
    catch (_a) {
        return {};
    }
}
function parseObject(raw) {
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    }
    catch (_a) {
        return {};
    }
}
// ── Main executor ──────────────────────────────────────────
export function executeHeartbeatRun(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
        const startMs = Date.now();
        let seq = 0;
        let checkpointSeq = 0;
        let runtimeConfigRaw = "{}";
        // 1. Create HeartbeatRun (or attach to one created by the daemon scheduler)
        let runId = input.runId;
        if (runId) {
            yield prisma.heartbeatRun.update({
                where: { id: runId },
                data: {
                    wakeupRequestId: (_a = input.wakeupRequestId) !== null && _a !== void 0 ? _a : null,
                    invocationSource: (_b = input.invocationSource) !== null && _b !== void 0 ? _b : "on_demand",
                    contextSnapshot: input.contextSnapshot
                        ? JSON.stringify(input.contextSnapshot)
                        : undefined,
                },
            });
        }
        else {
            const run = yield prisma.heartbeatRun.create({
                data: {
                    workspaceId: input.workspaceId,
                    agentId: input.agentId,
                    wakeupRequestId: (_c = input.wakeupRequestId) !== null && _c !== void 0 ? _c : null,
                    status: "queued",
                    invocationSource: (_d = input.invocationSource) !== null && _d !== void 0 ? _d : "on_demand",
                    contextSnapshot: input.contextSnapshot
                        ? JSON.stringify(input.contextSnapshot)
                        : null,
                },
            });
            runId = run.id;
        }
        if (!runId) {
            throw new Error("Heartbeat run ID is required");
        }
        const wakeupRequest = input.wakeupRequestId
            ? yield prisma.agentWakeupRequest.findUnique({
                where: { id: input.wakeupRequestId },
                select: {
                    id: true,
                    agentId: true,
                    reason: true,
                    triggerData: true,
                    retryCount: true,
                    maxRetries: true,
                    idempotencyKey: true,
                },
            })
            : null;
        const baseContextSnapshot = Object.assign(Object.assign({}, (wakeupRequest ? parseObject(wakeupRequest.triggerData) : {})), ((_e = input.contextSnapshot) !== null && _e !== void 0 ? _e : {}));
        const persistCheckpoint = (stepKey, checkpointType, state) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield createHeartbeatRunCheckpoint({
                    runId,
                    seq: checkpointSeq++,
                    stepKey,
                    checkpointType,
                    state,
                });
            }
            catch (checkpointError) {
                logger.warn("heartbeat-executor: failed to persist checkpoint", {
                    runId,
                    stepKey,
                    error: String(checkpointError),
                });
            }
        });
        yield persistCheckpoint("run.created", "run_state", {
            task: (_f = input.task) !== null && _f !== void 0 ? _f : (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
            invocationSource: (_g = input.invocationSource) !== null && _g !== void 0 ? _g : "on_demand",
            contextSnapshot: baseContextSnapshot,
            wakeupRequestId: (_h = input.wakeupRequestId) !== null && _h !== void 0 ? _h : null,
        });
        try {
            // 2. Budget check
            const budget = yield checkBudget(input.agentId);
            if (!budget.ok) {
                const budgetError = new Error("Monthly budget exceeded");
                yield prisma.heartbeatRun.update({
                    where: { id: runId },
                    data: {
                        status: "failed",
                        finishedAt: new Date(),
                        resultJson: JSON.stringify({
                            error: budgetError.message,
                            errorType: "budget_exceeded",
                        }),
                    },
                });
                yield addRunEvent(runId, "error", budgetError.message, seq++);
                yield persistCheckpoint("budget.rejected", "failure", {
                    error: budgetError.message,
                    errorType: "budget_exceeded",
                    spent: budget.spent,
                    budget: budget.budget,
                    contextSnapshot: baseContextSnapshot,
                });
                yield setAgentStatus(input.agentId, "paused");
                broadcastSSE("agent_budget_exceeded", {
                    agentId: input.agentId,
                    runId,
                    spent: budget.spent,
                    budget: budget.budget,
                });
                try {
                    const budgetAgent = yield prisma.agent.findUnique({
                        where: { id: input.agentId },
                        select: { name: true, runtimeConfig: true },
                    });
                    if (budgetAgent) {
                        const rc = parseTelegramChatId(budgetAgent.runtimeConfig);
                        if (rc) {
                            yield sendBudgetWarningTelegram(rc, budgetAgent.name, budget.spent, budget.budget);
                        }
                    }
                }
                catch (_w) {
                    // Ignore notification failures for budget warnings.
                }
                const retryDecision = wakeupRequest
                    ? yield applyWakeupFailure({
                        wakeupRequest,
                        workspaceId: input.workspaceId,
                        runId,
                        error: budgetError,
                        prismaClient: prisma,
                    })
                    : null;
                yield updateRuntimeState(input.agentId, {
                    status: "failed",
                    error: budgetError.message,
                    runId,
                });
                return {
                    runId,
                    status: "failed",
                    durationMs: Date.now() - startMs,
                    error: budgetError.message,
                    nextRetryAt: (_j = retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.nextRetryAt) === null || _j === void 0 ? void 0 : _j.toISOString(),
                    deadLettered: (retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.kind) === "dead_letter",
                };
            }
            // 3. Load agent
            const agent = yield prisma.agent.findUniqueOrThrow({
                where: { id: input.agentId },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    role: true,
                    definitionId: true,
                    runtimeConfig: true,
                    adapterType: true,
                    adapterConfig: true,
                    status: true,
                },
            });
            runtimeConfigRaw = agent.runtimeConfig;
            if (agent.status === "paused" || agent.status === "terminated") {
                yield prisma.heartbeatRun.update({
                    where: { id: runId },
                    data: {
                        status: "cancelled",
                        finishedAt: new Date(),
                        resultJson: JSON.stringify({
                            error: `Agent is ${agent.status}`,
                            errorType: "validation",
                        }),
                    },
                });
                yield addRunEvent(runId, "warning", `Agent is ${agent.status}`, seq++);
                yield persistCheckpoint("run.cancelled", "failure", {
                    error: `Agent is ${agent.status}`,
                    errorType: "validation",
                    contextSnapshot: baseContextSnapshot,
                });
                return {
                    runId,
                    status: "cancelled",
                    durationMs: Date.now() - startMs,
                    error: `Agent is ${agent.status}`,
                };
            }
            const circuitSnapshot = yield ensureAgentCircuitReady(input.agentId, agent.runtimeConfig);
            yield persistCheckpoint("circuit.ready", "run_state", {
                circuitState: circuitSnapshot.state,
                circuitOpenUntil: (_l = (_k = circuitSnapshot.openUntil) === null || _k === void 0 ? void 0 : _k.toISOString()) !== null && _l !== void 0 ? _l : null,
                contextSnapshot: baseContextSnapshot,
            });
            // 4. Mark running
            yield prisma.heartbeatRun.update({
                where: { id: runId },
                data: { status: "running", startedAt: new Date() },
            });
            yield setAgentStatus(input.agentId, "running");
            yield addRunEvent(runId, "start", "Heartbeat run started", seq++);
            yield persistCheckpoint("run.started", "run_state", {
                task: (_m = input.task) !== null && _m !== void 0 ? _m : (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
                invocationSource: (_o = input.invocationSource) !== null && _o !== void 0 ? _o : "on_demand",
                contextSnapshot: baseContextSnapshot,
            });
            yield syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
                logger.warn("heartbeat-executor: failed to sync workflow step after start", {
                    runId,
                    error: String(workflowError),
                });
            });
            broadcastSSE("agent_run_started", {
                agentId: input.agentId,
                runId,
                agentName: agent.name,
            });
            // 5. Execute based on adapter type
            let result;
            if (agent.adapterType === "internal") {
                result = yield executeInternal(agent, input.task, runId, input.workspaceId, (step) => {
                    addRunEvent(runId, "step", step, seq++).catch(() => { });
                });
            }
            else {
                const adapter = getAdapter(agent.adapterType);
                if (adapter) {
                    let adapterConfig = {};
                    try {
                        const rawConfig = yield resolveSecretRefs(agent.adapterConfig || "{}", input.workspaceId);
                        adapterConfig = JSON.parse(rawConfig);
                    }
                    catch (_x) {
                        adapterConfig = {};
                    }
                    const prompt = buildAgentPrompt(agent, input.task);
                    const adapterResult = yield adapter.execute({
                        agentId: agent.id,
                        prompt,
                        config: adapterConfig,
                        onEvent: (event) => {
                            addRunEvent(runId, "step", event, seq++).catch(() => { });
                        },
                    });
                    result = {
                        content: adapterResult.content,
                        tokens: adapterResult.tokens,
                        costUsd: adapterResult.costUsd,
                        model: adapterResult.model,
                        provider: adapterResult.provider,
                    };
                }
                else {
                    result = {
                        content: `[${agent.adapterType}] Unknown adapter type`,
                        tokens: 0,
                        costUsd: 0,
                        model: "external",
                        provider: agent.adapterType,
                    };
                    yield addRunEvent(runId, "warning", `Unknown adapter: ${agent.adapterType}`, seq++);
                }
            }
            // 6. Mark succeeded
            const durationMs = Date.now() - startMs;
            const costCents = Math.round(result.costUsd * 100);
            yield prisma.heartbeatRun.update({
                where: { id: runId },
                data: {
                    status: "succeeded",
                    finishedAt: new Date(),
                    usageJson: JSON.stringify({
                        tokens: result.tokens,
                        costUsd: result.costUsd,
                        model: result.model,
                        provider: result.provider,
                        durationMs,
                    }),
                    resultJson: JSON.stringify({
                        content: result.content.slice(0, 10000),
                    }),
                },
            });
            yield addRunEvent(runId, "completed", `Finished in ${durationMs}ms, ${result.tokens} tokens`, seq++);
            yield persistCheckpoint("run.completed", "result", {
                task: (_p = input.task) !== null && _p !== void 0 ? _p : (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
                contextSnapshot: baseContextSnapshot,
                usage: {
                    tokens: result.tokens,
                    costUsd: result.costUsd,
                    model: result.model,
                    provider: result.provider,
                    durationMs,
                },
                resultPreview: result.content.slice(0, 500),
            });
            yield recordAgentCircuitSuccess(input.agentId);
            // 7. Update runtime state & agent status
            yield updateRuntimeState(input.agentId, {
                status: "succeeded",
                tokens: result.tokens,
                costCents,
                error: null,
                runId,
                consecutiveFailures: 0,
                circuitState: "closed",
                circuitOpenedAt: null,
                circuitOpenUntil: null,
            });
            yield setAgentStatus(input.agentId, "idle");
            // 8. Update spent budget
            if (costCents > 0) {
                yield prisma.agent.update({
                    where: { id: input.agentId },
                    data: { spentMonthlyCents: { increment: costCents } },
                });
            }
            // 9. Track in AIRunCost for unified reporting
            try {
                yield prisma.aIRunCost.create({
                    data: {
                        provider: result.provider,
                        model: result.model,
                        inputTokens: Math.round(result.tokens * 0.7),
                        outputTokens: Math.round(result.tokens * 0.3),
                        costUsd: result.costUsd,
                        costRub: result.costUsd * 95,
                        agentId: (_q = agent.definitionId) !== null && _q !== void 0 ? _q : agent.slug,
                        workspaceId: input.workspaceId,
                        runId,
                        agentDbId: input.agentId,
                    },
                });
            }
            catch (costError) {
                logger.warn("heartbeat-executor: failed to track cost", {
                    error: String(costError),
                });
            }
            // 10. Broadcast completion
            broadcastSSE("agent_run_completed", {
                agentId: input.agentId,
                runId,
                agentName: agent.name,
                status: "succeeded",
                durationMs,
                tokens: result.tokens,
            });
            yield sendTelegramIfConfigured(agent, {
                agentName: agent.name,
                runId,
                status: "succeeded",
                durationMs,
                tokenCount: result.tokens,
                costCents,
                summary: result.content.slice(0, 500),
            });
            yield syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
                logger.warn("heartbeat-executor: failed to sync workflow step after success", {
                    runId,
                    error: String(workflowError),
                });
            });
            if (input.wakeupRequestId) {
                yield prisma.agentWakeupRequest
                    .update({
                    where: { id: input.wakeupRequestId },
                    data: { status: "processed", processedAt: new Date() },
                })
                    .catch(() => { });
            }
            return {
                runId,
                status: "succeeded",
                durationMs,
                content: result.content,
                tokens: result.tokens,
                costUsd: result.costUsd,
            };
        }
        catch (error) {
            const durationMs = Date.now() - startMs;
            const errMsg = getErrorMessage(error, "Heartbeat execution failed");
            const classification = classifyOrchestrationFailure(error);
            const circuitSnapshot = error instanceof AgentCircuitOpenError
                ? {
                    state: "open",
                    consecutiveFailures: 0,
                    openedAt: null,
                    openUntil: (_r = error.openUntil) !== null && _r !== void 0 ? _r : null,
                }
                : yield recordAgentCircuitFailure(input.agentId, runtimeConfigRaw);
            yield prisma.heartbeatRun
                .update({
                where: { id: runId },
                data: {
                    status: "failed",
                    finishedAt: new Date(),
                    resultJson: JSON.stringify({
                        error: errMsg,
                        errorType: classification.errorType,
                    }),
                },
            })
                .catch(() => { });
            yield addRunEvent(runId, "error", errMsg, seq++).catch(() => { });
            yield persistCheckpoint("run.failed", "failure", {
                task: (_s = input.task) !== null && _s !== void 0 ? _s : (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
                contextSnapshot: baseContextSnapshot,
                error: errMsg,
                errorType: classification.errorType,
            });
            const retryDecision = wakeupRequest
                ? yield applyWakeupFailure({
                    wakeupRequest,
                    workspaceId: input.workspaceId,
                    runId,
                    runtimeConfig: runtimeConfigRaw,
                    error,
                    prismaClient: prisma,
                })
                : null;
            yield updateRuntimeState(input.agentId, {
                status: "failed",
                error: errMsg,
                runId,
                consecutiveFailures: circuitSnapshot.consecutiveFailures,
                circuitState: circuitSnapshot.state,
                circuitOpenedAt: circuitSnapshot.openedAt,
                circuitOpenUntil: circuitSnapshot.openUntil,
            });
            yield setAgentStatus(input.agentId, (retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.kind) === "requeue" && circuitSnapshot.state !== "open"
                ? "idle"
                : "error");
            broadcastSSE("agent_run_failed", {
                agentId: input.agentId,
                runId,
                error: errMsg,
                nextRetryAt: (_u = (_t = retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.nextRetryAt) === null || _t === void 0 ? void 0 : _t.toISOString()) !== null && _u !== void 0 ? _u : null,
                deadLettered: (retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.kind) === "dead_letter",
            });
            try {
                const failedAgent = yield prisma.agent.findUnique({
                    where: { id: input.agentId },
                    select: { name: true, runtimeConfig: true },
                });
                if (failedAgent) {
                    yield sendTelegramIfConfigured(Object.assign(Object.assign({}, failedAgent), { runtimeConfig: failedAgent.runtimeConfig }), {
                        agentName: failedAgent.name,
                        runId,
                        status: "failed",
                        durationMs,
                        tokenCount: 0,
                        costCents: 0,
                        summary: null,
                        errorMessage: errMsg,
                    });
                }
            }
            catch (_y) {
                // Ignore notification failures on failed runs.
            }
            logger.error("heartbeat-executor: run failed", {
                runId,
                agentId: input.agentId,
                error: errMsg,
            });
            yield syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
                logger.warn("heartbeat-executor: failed to sync workflow step after failure", {
                    runId,
                    error: String(workflowError),
                });
            });
            return {
                runId,
                status: "failed",
                durationMs,
                error: errMsg,
                nextRetryAt: (_v = retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.nextRetryAt) === null || _v === void 0 ? void 0 : _v.toISOString(),
                deadLettered: (retryDecision === null || retryDecision === void 0 ? void 0 : retryDecision.kind) === "dead_letter",
            };
        }
    });
}
// ── Internal adapter (uses existing CEOClaw execution engine) ──
const INTERNAL_PROVIDER_CHAIN = ["openrouter", "zai", "mock"];
const INTERNAL_RETRYABLE_ERRORS = [
    "econnreset",
    "etimedout",
    "enotfound",
    "eai_again",
    "socket hang up",
    "rate_limit",
    "rate limit",
    "overloaded",
    "timeout",
    "429",
    "502",
    "503",
    "504",
];
const INTERNAL_MODEL_HINTS = {
    openrouter: "google/gemini-3.1-flash-lite-preview",
    zai: "glm-5",
    openai: "gpt-5.2",
    mock: "mock",
};
function estimateInternalTokens(text) {
    return Math.ceil(text.length / 4);
}
function isRetryableInternalError(message) {
    const lower = message.toLowerCase();
    return INTERNAL_RETRYABLE_ERRORS.some((token) => lower.includes(token));
}
function runInternalAttempt(args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { agentId, systemPrompt, task, provider, runId, workspaceId, timeoutMs, onStep } = args;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: task },
            ];
            const result = yield runAgentExecution(messages, {
                router: getRouter(),
                provider,
                agentId,
                runId,
                workspaceId,
                enableTools: false,
                signal: controller.signal,
                onStep: (step) => {
                    var _a, _b, _c, _d, _e, _f;
                    if (step.type === "message" && typeof step.content === "string") {
                        const preview = step.content.slice(0, 200);
                        onStep(`message (round ${step.round}): ${preview}`);
                    }
                    else if (step.type === "error") {
                        onStep(`error (round ${step.round}): ${(_a = step.error) !== null && _a !== void 0 ? _a : "unknown"}`);
                    }
                    else if (step.type === "tool_call") {
                        onStep(`tool_call: ${(_d = (_c = (_b = step.toolCall) === null || _b === void 0 ? void 0 : _b.function) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "unknown"}`);
                    }
                    else if (step.type === "tool_result") {
                        const resultName = (_f = (_e = step.toolResult) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "unknown";
                        onStep(`tool_result: ${resultName}`);
                    }
                },
            });
            if (result.aborted) {
                throw new Error(`Execution aborted (duration=${result.durationMs}ms)`);
            }
            const content = (_a = result.finalContent) !== null && _a !== void 0 ? _a : "";
            const model = (_b = INTERNAL_MODEL_HINTS[provider]) !== null && _b !== void 0 ? _b : "unknown";
            return {
                content,
                tokens: estimateInternalTokens(systemPrompt + task + content),
                // Authoritative spend lives in `AIRunCost` via trackCost inside the
                // kernel; surface a rough estimate so HeartbeatRun.costUsd stays
                // populated for legacy UI bindings.
                costUsd: content.length * 0.000001,
                model,
                provider,
            };
        }
        finally {
            clearTimeout(timer);
        }
    });
}
function executeInternal(agent, task, runId, workspaceId, onStep) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const runtimeConfig = parseRuntimeConfig(agent.runtimeConfig);
        const timeoutMs = ((_a = runtimeConfig.timeoutSec) !== null && _a !== void 0 ? _a : 120) * 1000;
        const agentId = (_b = agent.definitionId) !== null && _b !== void 0 ? _b : agent.slug;
        const systemPrompt = buildAgentPrompt(agent, task);
        const effectiveTask = task !== null && task !== void 0 ? task : "Perform your scheduled duties. Check pending tasks and provide updates.";
        let lastError;
        for (let providerIndex = 0; providerIndex < INTERNAL_PROVIDER_CHAIN.length; providerIndex++) {
            const provider = INTERNAL_PROVIDER_CHAIN[providerIndex];
            onStep(`starting: ${provider}`);
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const result = yield runInternalAttempt({
                        agentId,
                        systemPrompt,
                        task: effectiveTask,
                        provider,
                        runId,
                        workspaceId,
                        timeoutMs,
                        onStep,
                    });
                    onStep(`completed: ${provider} (attempt ${attempt})`);
                    return result;
                }
                catch (err) {
                    lastError = err instanceof Error ? err.message : String(err);
                    logger.warn("heartbeat-executor: internal attempt failed", {
                        agentId,
                        runId,
                        provider,
                        attempt,
                        error: lastError,
                    });
                    onStep(`retrying: ${provider} (attempt ${attempt}/2): ${lastError}`);
                    if (!isRetryableInternalError(lastError))
                        break;
                    if (attempt < 2) {
                        yield new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                    }
                }
            }
        }
        throw new Error(lastError !== null && lastError !== void 0 ? lastError : "Agent execution failed");
    });
}
// ── Telegram integration helpers ───────────────────────────
function parseTelegramChatId(runtimeConfig) {
    var _a;
    try {
        const rc = JSON.parse(runtimeConfig || "{}");
        return (_a = rc.telegramChatId) !== null && _a !== void 0 ? _a : null;
    }
    catch (_b) {
        return null;
    }
}
function sendTelegramIfConfigured(agent, notification) {
    return __awaiter(this, void 0, void 0, function* () {
        const chatId = parseTelegramChatId(agent.runtimeConfig);
        if (!chatId)
            return;
        try {
            yield sendHeartbeatTelegramNotification(chatId, notification);
        }
        catch (e) {
            logger.warn("telegram-notify: failed", { error: String(e) });
        }
    });
}
// ── Process wakeup queue ───────────────────────────────────
export function processWakeupQueue() {
    return __awaiter(this, arguments, void 0, function* (limit = 5) {
        var _a;
        const requests = yield prisma.agentWakeupRequest.findMany({
            where: {
                status: "queued",
                availableAt: { lte: new Date() },
            },
            include: { agent: { select: { workspaceId: true, status: true } } },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
            take: limit,
        });
        let processed = 0;
        for (const req of requests) {
            if (req.agent.status === "paused" || req.agent.status === "terminated") {
                yield prisma.agentWakeupRequest.update({
                    where: { id: req.id },
                    data: { status: "skipped", processedAt: new Date() },
                });
                continue;
            }
            let triggerData = {};
            try {
                triggerData = JSON.parse(req.triggerData || "{}");
            }
            catch ( /* empty */_b) { /* empty */ }
            yield executeHeartbeatRun({
                runId: typeof triggerData.runId === "string" && triggerData.runId.trim()
                    ? triggerData.runId
                    : undefined,
                agentId: req.agentId,
                workspaceId: req.agent.workspaceId,
                wakeupRequestId: req.id,
                invocationSource: req.reason,
                task: (_a = triggerData.task) !== null && _a !== void 0 ? _a : undefined,
                contextSnapshot: triggerData,
            });
            processed++;
        }
        return processed;
    });
}
