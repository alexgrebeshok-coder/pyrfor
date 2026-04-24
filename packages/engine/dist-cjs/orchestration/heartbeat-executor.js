"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBudget = checkBudget;
exports.executeHeartbeatRun = executeHeartbeatRun;
exports.processWakeupQueue = processWakeupQueue;
const prisma_1 = require("../prisma");
const agents_1 = require("../ai/agents");
const sse_1 = require("../transport/sse");
const logger_1 = require("../observability/logger");
const agent_executor_1 = require("../ai/agent-executor");
const providers_1 = require("../ai/providers");
const telegram_notify_1 = require("./telegram-notify");
const adapters_1 = require("./adapters");
const agent_secrets_1 = require("./agent-secrets");
const error_utils_1 = require("./error-utils");
const retry_policy_service_1 = require("./retry-policy-service");
const circuit_breaker_service_1 = require("./circuit-breaker-service");
const checkpoint_service_1 = require("./checkpoint-service");
const workflow_service_1 = require("./workflow-service");
// ── Event logger ───────────────────────────────────────────
async function addRunEvent(runId, type, content, seq) {
    await prisma_1.prisma.heartbeatRunEvent.create({
        data: { runId, seq, type, content },
    });
}
// ── Budget check ───────────────────────────────────────────
async function checkBudget(agentId) {
    const agent = await prisma_1.prisma.agent.findUnique({
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
}
// ── Runtime State update ───────────────────────────────────
async function updateRuntimeState(agentId, update) {
    const existing = await prisma_1.prisma.agentRuntimeState.findUnique({
        where: { agentId },
    });
    const data = {
        agentId,
        lastHeartbeatAt: new Date(),
        lastRunId: update.runId ?? existing?.lastRunId ?? null,
        lastError: update.error ?? null,
        totalRuns: (existing?.totalRuns ?? 0) + (update.status === "succeeded" || update.status === "failed" ? 1 : 0),
        successfulRuns: (existing?.successfulRuns ?? 0) +
            (update.status === "succeeded" ? 1 : 0),
        totalTokens: (existing?.totalTokens ?? 0) + (update.tokens ?? 0),
        totalCostCents: (existing?.totalCostCents ?? 0) + (update.costCents ?? 0),
        consecutiveFailures: update.consecutiveFailures ?? existing?.consecutiveFailures ?? 0,
        circuitState: update.circuitState ?? existing?.circuitState ?? "closed",
        circuitOpenedAt: update.circuitOpenedAt ?? existing?.circuitOpenedAt ?? null,
        circuitOpenUntil: update.circuitOpenUntil ?? existing?.circuitOpenUntil ?? null,
    };
    await prisma_1.prisma.agentRuntimeState.upsert({
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
}
// ── Agent status transitions ───────────────────────────────
async function setAgentStatus(agentId, status) {
    await prisma_1.prisma.agent.update({
        where: { id: agentId },
        data: { status },
    });
}
// ── Build agent prompt ─────────────────────────────────────
function buildAgentPrompt(agent, task) {
    const definition = agent.definitionId
        ? agents_1.aiAgents.find((d) => d.id === agent.definitionId)
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
    catch {
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
    catch {
        return {};
    }
}
// ── Main executor ──────────────────────────────────────────
async function executeHeartbeatRun(input) {
    const startMs = Date.now();
    let seq = 0;
    let checkpointSeq = 0;
    let runtimeConfigRaw = "{}";
    // 1. Create HeartbeatRun (or attach to one created by the daemon scheduler)
    let runId = input.runId;
    if (runId) {
        await prisma_1.prisma.heartbeatRun.update({
            where: { id: runId },
            data: {
                wakeupRequestId: input.wakeupRequestId ?? null,
                invocationSource: input.invocationSource ?? "on_demand",
                contextSnapshot: input.contextSnapshot
                    ? JSON.stringify(input.contextSnapshot)
                    : undefined,
            },
        });
    }
    else {
        const run = await prisma_1.prisma.heartbeatRun.create({
            data: {
                workspaceId: input.workspaceId,
                agentId: input.agentId,
                wakeupRequestId: input.wakeupRequestId ?? null,
                status: "queued",
                invocationSource: input.invocationSource ?? "on_demand",
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
        ? await prisma_1.prisma.agentWakeupRequest.findUnique({
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
    const baseContextSnapshot = {
        ...(wakeupRequest ? parseObject(wakeupRequest.triggerData) : {}),
        ...(input.contextSnapshot ?? {}),
    };
    const persistCheckpoint = async (stepKey, checkpointType, state) => {
        try {
            await (0, checkpoint_service_1.createHeartbeatRunCheckpoint)({
                runId,
                seq: checkpointSeq++,
                stepKey,
                checkpointType,
                state,
            });
        }
        catch (checkpointError) {
            logger_1.logger.warn("heartbeat-executor: failed to persist checkpoint", {
                runId,
                stepKey,
                error: String(checkpointError),
            });
        }
    };
    await persistCheckpoint("run.created", "run_state", {
        task: input.task ??
            (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
        invocationSource: input.invocationSource ?? "on_demand",
        contextSnapshot: baseContextSnapshot,
        wakeupRequestId: input.wakeupRequestId ?? null,
    });
    try {
        // 2. Budget check
        const budget = await checkBudget(input.agentId);
        if (!budget.ok) {
            const budgetError = new Error("Monthly budget exceeded");
            await prisma_1.prisma.heartbeatRun.update({
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
            await addRunEvent(runId, "error", budgetError.message, seq++);
            await persistCheckpoint("budget.rejected", "failure", {
                error: budgetError.message,
                errorType: "budget_exceeded",
                spent: budget.spent,
                budget: budget.budget,
                contextSnapshot: baseContextSnapshot,
            });
            await setAgentStatus(input.agentId, "paused");
            (0, sse_1.broadcastSSE)("agent_budget_exceeded", {
                agentId: input.agentId,
                runId,
                spent: budget.spent,
                budget: budget.budget,
            });
            try {
                const budgetAgent = await prisma_1.prisma.agent.findUnique({
                    where: { id: input.agentId },
                    select: { name: true, runtimeConfig: true },
                });
                if (budgetAgent) {
                    const rc = parseTelegramChatId(budgetAgent.runtimeConfig);
                    if (rc) {
                        await (0, telegram_notify_1.sendBudgetWarningTelegram)(rc, budgetAgent.name, budget.spent, budget.budget);
                    }
                }
            }
            catch {
                // Ignore notification failures for budget warnings.
            }
            const retryDecision = wakeupRequest
                ? await (0, retry_policy_service_1.applyWakeupFailure)({
                    wakeupRequest,
                    workspaceId: input.workspaceId,
                    runId,
                    error: budgetError,
                    prismaClient: prisma_1.prisma,
                })
                : null;
            await updateRuntimeState(input.agentId, {
                status: "failed",
                error: budgetError.message,
                runId,
            });
            return {
                runId,
                status: "failed",
                durationMs: Date.now() - startMs,
                error: budgetError.message,
                nextRetryAt: retryDecision?.nextRetryAt?.toISOString(),
                deadLettered: retryDecision?.kind === "dead_letter",
            };
        }
        // 3. Load agent
        const agent = await prisma_1.prisma.agent.findUniqueOrThrow({
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
            await prisma_1.prisma.heartbeatRun.update({
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
            await addRunEvent(runId, "warning", `Agent is ${agent.status}`, seq++);
            await persistCheckpoint("run.cancelled", "failure", {
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
        const circuitSnapshot = await (0, circuit_breaker_service_1.ensureAgentCircuitReady)(input.agentId, agent.runtimeConfig);
        await persistCheckpoint("circuit.ready", "run_state", {
            circuitState: circuitSnapshot.state,
            circuitOpenUntil: circuitSnapshot.openUntil?.toISOString() ?? null,
            contextSnapshot: baseContextSnapshot,
        });
        // 4. Mark running
        await prisma_1.prisma.heartbeatRun.update({
            where: { id: runId },
            data: { status: "running", startedAt: new Date() },
        });
        await setAgentStatus(input.agentId, "running");
        await addRunEvent(runId, "start", "Heartbeat run started", seq++);
        await persistCheckpoint("run.started", "run_state", {
            task: input.task ??
                (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
            invocationSource: input.invocationSource ?? "on_demand",
            contextSnapshot: baseContextSnapshot,
        });
        await (0, workflow_service_1.syncWorkflowStepFromHeartbeatRun)(runId).catch((workflowError) => {
            logger_1.logger.warn("heartbeat-executor: failed to sync workflow step after start", {
                runId,
                error: String(workflowError),
            });
        });
        (0, sse_1.broadcastSSE)("agent_run_started", {
            agentId: input.agentId,
            runId,
            agentName: agent.name,
        });
        // 5. Execute based on adapter type
        let result;
        if (agent.adapterType === "internal") {
            result = await executeInternal(agent, input.task, runId, input.workspaceId, (step) => {
                addRunEvent(runId, "step", step, seq++).catch(() => { });
            });
        }
        else {
            const adapter = (0, adapters_1.getAdapter)(agent.adapterType);
            if (adapter) {
                let adapterConfig = {};
                try {
                    const rawConfig = await (0, agent_secrets_1.resolveSecretRefs)(agent.adapterConfig || "{}", input.workspaceId);
                    adapterConfig = JSON.parse(rawConfig);
                }
                catch {
                    adapterConfig = {};
                }
                const prompt = buildAgentPrompt(agent, input.task);
                const adapterResult = await adapter.execute({
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
                await addRunEvent(runId, "warning", `Unknown adapter: ${agent.adapterType}`, seq++);
            }
        }
        // 6. Mark succeeded
        const durationMs = Date.now() - startMs;
        const costCents = Math.round(result.costUsd * 100);
        await prisma_1.prisma.heartbeatRun.update({
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
        await addRunEvent(runId, "completed", `Finished in ${durationMs}ms, ${result.tokens} tokens`, seq++);
        await persistCheckpoint("run.completed", "result", {
            task: input.task ??
                (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
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
        await (0, circuit_breaker_service_1.recordAgentCircuitSuccess)(input.agentId);
        // 7. Update runtime state & agent status
        await updateRuntimeState(input.agentId, {
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
        await setAgentStatus(input.agentId, "idle");
        // 8. Update spent budget
        if (costCents > 0) {
            await prisma_1.prisma.agent.update({
                where: { id: input.agentId },
                data: { spentMonthlyCents: { increment: costCents } },
            });
        }
        // 9. Track in AIRunCost for unified reporting
        try {
            await prisma_1.prisma.aIRunCost.create({
                data: {
                    provider: result.provider,
                    model: result.model,
                    inputTokens: Math.round(result.tokens * 0.7),
                    outputTokens: Math.round(result.tokens * 0.3),
                    costUsd: result.costUsd,
                    costRub: result.costUsd * 95,
                    agentId: agent.definitionId ?? agent.slug,
                    workspaceId: input.workspaceId,
                    runId,
                    agentDbId: input.agentId,
                },
            });
        }
        catch (costError) {
            logger_1.logger.warn("heartbeat-executor: failed to track cost", {
                error: String(costError),
            });
        }
        // 10. Broadcast completion
        (0, sse_1.broadcastSSE)("agent_run_completed", {
            agentId: input.agentId,
            runId,
            agentName: agent.name,
            status: "succeeded",
            durationMs,
            tokens: result.tokens,
        });
        await sendTelegramIfConfigured(agent, {
            agentName: agent.name,
            runId,
            status: "succeeded",
            durationMs,
            tokenCount: result.tokens,
            costCents,
            summary: result.content.slice(0, 500),
        });
        await (0, workflow_service_1.syncWorkflowStepFromHeartbeatRun)(runId).catch((workflowError) => {
            logger_1.logger.warn("heartbeat-executor: failed to sync workflow step after success", {
                runId,
                error: String(workflowError),
            });
        });
        if (input.wakeupRequestId) {
            await prisma_1.prisma.agentWakeupRequest
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
        const errMsg = (0, error_utils_1.getErrorMessage)(error, "Heartbeat execution failed");
        const classification = (0, retry_policy_service_1.classifyOrchestrationFailure)(error);
        const circuitSnapshot = error instanceof circuit_breaker_service_1.AgentCircuitOpenError
            ? {
                state: "open",
                consecutiveFailures: 0,
                openedAt: null,
                openUntil: error.openUntil ?? null,
            }
            : await (0, circuit_breaker_service_1.recordAgentCircuitFailure)(input.agentId, runtimeConfigRaw);
        await prisma_1.prisma.heartbeatRun
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
        await addRunEvent(runId, "error", errMsg, seq++).catch(() => { });
        await persistCheckpoint("run.failed", "failure", {
            task: input.task ??
                (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
            contextSnapshot: baseContextSnapshot,
            error: errMsg,
            errorType: classification.errorType,
        });
        const retryDecision = wakeupRequest
            ? await (0, retry_policy_service_1.applyWakeupFailure)({
                wakeupRequest,
                workspaceId: input.workspaceId,
                runId,
                runtimeConfig: runtimeConfigRaw,
                error,
                prismaClient: prisma_1.prisma,
            })
            : null;
        await updateRuntimeState(input.agentId, {
            status: "failed",
            error: errMsg,
            runId,
            consecutiveFailures: circuitSnapshot.consecutiveFailures,
            circuitState: circuitSnapshot.state,
            circuitOpenedAt: circuitSnapshot.openedAt,
            circuitOpenUntil: circuitSnapshot.openUntil,
        });
        await setAgentStatus(input.agentId, retryDecision?.kind === "requeue" && circuitSnapshot.state !== "open"
            ? "idle"
            : "error");
        (0, sse_1.broadcastSSE)("agent_run_failed", {
            agentId: input.agentId,
            runId,
            error: errMsg,
            nextRetryAt: retryDecision?.nextRetryAt?.toISOString() ?? null,
            deadLettered: retryDecision?.kind === "dead_letter",
        });
        try {
            const failedAgent = await prisma_1.prisma.agent.findUnique({
                where: { id: input.agentId },
                select: { name: true, runtimeConfig: true },
            });
            if (failedAgent) {
                await sendTelegramIfConfigured({ ...failedAgent, runtimeConfig: failedAgent.runtimeConfig }, {
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
        catch {
            // Ignore notification failures on failed runs.
        }
        logger_1.logger.error("heartbeat-executor: run failed", {
            runId,
            agentId: input.agentId,
            error: errMsg,
        });
        await (0, workflow_service_1.syncWorkflowStepFromHeartbeatRun)(runId).catch((workflowError) => {
            logger_1.logger.warn("heartbeat-executor: failed to sync workflow step after failure", {
                runId,
                error: String(workflowError),
            });
        });
        return {
            runId,
            status: "failed",
            durationMs,
            error: errMsg,
            nextRetryAt: retryDecision?.nextRetryAt?.toISOString(),
            deadLettered: retryDecision?.kind === "dead_letter",
        };
    }
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
async function runInternalAttempt(args) {
    const { agentId, systemPrompt, task, provider, runId, workspaceId, timeoutMs, onStep } = args;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: task },
        ];
        const result = await (0, agent_executor_1.runAgentExecution)(messages, {
            router: (0, providers_1.getRouter)(),
            provider,
            agentId,
            runId,
            workspaceId,
            enableTools: false,
            signal: controller.signal,
            onStep: (step) => {
                if (step.type === "message" && typeof step.content === "string") {
                    const preview = step.content.slice(0, 200);
                    onStep(`message (round ${step.round}): ${preview}`);
                }
                else if (step.type === "error") {
                    onStep(`error (round ${step.round}): ${step.error ?? "unknown"}`);
                }
                else if (step.type === "tool_call") {
                    onStep(`tool_call: ${step.toolCall?.function?.name ?? "unknown"}`);
                }
                else if (step.type === "tool_result") {
                    const resultName = step.toolResult?.name ?? "unknown";
                    onStep(`tool_result: ${resultName}`);
                }
            },
        });
        if (result.aborted) {
            throw new Error(`Execution aborted (duration=${result.durationMs}ms)`);
        }
        const content = result.finalContent ?? "";
        const model = INTERNAL_MODEL_HINTS[provider] ?? "unknown";
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
}
async function executeInternal(agent, task, runId, workspaceId, onStep) {
    const runtimeConfig = parseRuntimeConfig(agent.runtimeConfig);
    const timeoutMs = (runtimeConfig.timeoutSec ?? 120) * 1000;
    const agentId = agent.definitionId ?? agent.slug;
    const systemPrompt = buildAgentPrompt(agent, task);
    const effectiveTask = task ?? "Perform your scheduled duties. Check pending tasks and provide updates.";
    let lastError;
    for (let providerIndex = 0; providerIndex < INTERNAL_PROVIDER_CHAIN.length; providerIndex++) {
        const provider = INTERNAL_PROVIDER_CHAIN[providerIndex];
        onStep(`starting: ${provider}`);
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const result = await runInternalAttempt({
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
                logger_1.logger.warn("heartbeat-executor: internal attempt failed", {
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
                    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                }
            }
        }
    }
    throw new Error(lastError ?? "Agent execution failed");
}
// ── Telegram integration helpers ───────────────────────────
function parseTelegramChatId(runtimeConfig) {
    try {
        const rc = JSON.parse(runtimeConfig || "{}");
        return rc.telegramChatId ?? null;
    }
    catch {
        return null;
    }
}
async function sendTelegramIfConfigured(agent, notification) {
    const chatId = parseTelegramChatId(agent.runtimeConfig);
    if (!chatId)
        return;
    try {
        await (0, telegram_notify_1.sendHeartbeatTelegramNotification)(chatId, notification);
    }
    catch (e) {
        logger_1.logger.warn("telegram-notify: failed", { error: String(e) });
    }
}
// ── Process wakeup queue ───────────────────────────────────
async function processWakeupQueue(limit = 5) {
    const requests = await prisma_1.prisma.agentWakeupRequest.findMany({
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
            await prisma_1.prisma.agentWakeupRequest.update({
                where: { id: req.id },
                data: { status: "skipped", processedAt: new Date() },
            });
            continue;
        }
        let triggerData = {};
        try {
            triggerData = JSON.parse(req.triggerData || "{}");
        }
        catch { /* empty */ }
        await executeHeartbeatRun({
            runId: typeof triggerData.runId === "string" && triggerData.runId.trim()
                ? triggerData.runId
                : undefined,
            agentId: req.agentId,
            workspaceId: req.agent.workspaceId,
            wakeupRequestId: req.id,
            invocationSource: req.reason,
            task: triggerData.task ?? undefined,
            contextSnapshot: triggerData,
        });
        processed++;
    }
    return processed;
}
