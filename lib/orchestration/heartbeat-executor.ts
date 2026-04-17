/**
 * Heartbeat Executor — bridges HeartbeatRun → existing agent execution engine
 *
 * Flow:
 * 1. Dequeue AgentWakeupRequest (or accept direct trigger)
 * 2. Create or attach to a HeartbeatRun record (status: queued → running)
 * 3. Resolve agent definition → build system prompt
 * 4. Execute via improvedExecutor (retry + fallback built-in)
 * 5. Record events, update HeartbeatRun (succeeded/failed), update RuntimeState
 * 6. Track cost via existing AIRunCost
 * 7. Broadcast SSE events for live UI updates
 */

import { prisma } from "@/lib/prisma";
import { aiAgents } from "@/lib/ai/agents";
import { broadcastSSE } from "@/lib/sse";
import { logger } from "@/lib/logger";
import { sendHeartbeatTelegramNotification, sendBudgetWarningTelegram } from "./telegram-notify";
import { getAdapter } from "./adapters";
import { resolveSecretRefs } from "./agent-secrets";
import { getErrorMessage } from "./error-utils";
import {
  applyWakeupFailure,
  classifyOrchestrationFailure,
} from "./retry-policy-service";
import {
  AgentCircuitOpenError,
  ensureAgentCircuitReady,
  recordAgentCircuitFailure,
  recordAgentCircuitSuccess,
} from "./circuit-breaker-service";
import { createHeartbeatRunCheckpoint } from "./checkpoint-service";
import { syncWorkflowStepFromHeartbeatRun } from "./workflow-service";
import type { AgentRuntimeConfig, RunStatus } from "./types";

// ── Types ──────────────────────────────────────────────────

export interface HeartbeatRunInput {
  runId?: string;
  agentId: string;
  workspaceId: string;
  wakeupRequestId?: string;
  invocationSource?: string;
  task?: string;
  contextSnapshot?: Record<string, unknown>;
}

export interface HeartbeatRunResult {
  runId: string;
  status: RunStatus;
  durationMs: number;
  content?: string;
  error?: string;
  tokens?: number;
  costUsd?: number;
  nextRetryAt?: string;
  deadLettered?: boolean;
}

// ── Event logger ───────────────────────────────────────────

async function addRunEvent(
  runId: string,
  type: string,
  content: string,
  seq: number
) {
  await prisma.heartbeatRunEvent.create({
    data: { runId, seq, type, content },
  });
}

// ── Budget check ───────────────────────────────────────────

export async function checkBudget(
  agentId: string
): Promise<{ ok: boolean; spent: number; budget: number }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { budgetMonthlyCents: true, spentMonthlyCents: true },
  });
  if (!agent) return { ok: false, spent: 0, budget: 0 };
  if (agent.budgetMonthlyCents === 0)
    return { ok: true, spent: agent.spentMonthlyCents, budget: 0 };
  return {
    ok: agent.spentMonthlyCents < agent.budgetMonthlyCents,
    spent: agent.spentMonthlyCents,
    budget: agent.budgetMonthlyCents,
  };
}

// ── Runtime State update ───────────────────────────────────

async function updateRuntimeState(
  agentId: string,
  update: {
    status?: RunStatus;
    tokens?: number;
    costCents?: number;
    error?: string | null;
    runId?: string;
    consecutiveFailures?: number;
    circuitState?: string;
    circuitOpenedAt?: Date | null;
    circuitOpenUntil?: Date | null;
  }
) {
  const existing = await prisma.agentRuntimeState.findUnique({
    where: { agentId },
  });

  const data = {
    agentId,
    lastHeartbeatAt: new Date(),
    lastRunId: update.runId ?? existing?.lastRunId ?? null,
    lastError: update.error ?? null,
    totalRuns: (existing?.totalRuns ?? 0) + (update.status === "succeeded" || update.status === "failed" ? 1 : 0),
    successfulRuns:
      (existing?.successfulRuns ?? 0) +
      (update.status === "succeeded" ? 1 : 0),
    totalTokens: (existing?.totalTokens ?? 0) + (update.tokens ?? 0),
    totalCostCents: (existing?.totalCostCents ?? 0) + (update.costCents ?? 0),
    consecutiveFailures: update.consecutiveFailures ?? existing?.consecutiveFailures ?? 0,
    circuitState: update.circuitState ?? existing?.circuitState ?? "closed",
    circuitOpenedAt: update.circuitOpenedAt ?? existing?.circuitOpenedAt ?? null,
    circuitOpenUntil: update.circuitOpenUntil ?? existing?.circuitOpenUntil ?? null,
  };

  await prisma.agentRuntimeState.upsert({
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

async function setAgentStatus(agentId: string, status: string) {
  await prisma.agent.update({
    where: { id: agentId },
    data: { status },
  });
}

// ── Build agent prompt ─────────────────────────────────────

function buildAgentPrompt(
  agent: {
    name: string;
    role: string;
    definitionId: string | null;
    runtimeConfig: string;
  },
  task?: string
): string {
  const definition = agent.definitionId
    ? aiAgents.find((d) => d.id === agent.definitionId)
    : null;

  const runtimeConfig = parseRuntimeConfig(agent.runtimeConfig);

  const parts: string[] = [];

  if (runtimeConfig.systemPromptPrefix) {
    parts.push(runtimeConfig.systemPromptPrefix);
  }

  if (definition) {
    parts.push(
      `You are ${agent.name}, role: ${agent.role}.`,
      `Agent type: ${definition.id}, category: ${definition.category}`
    );
  } else {
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

function parseRuntimeConfig(raw: string): AgentRuntimeConfig {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as AgentRuntimeConfig)
      : {};
  } catch {
    return {};
  }
}

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ── Main executor ──────────────────────────────────────────

export async function executeHeartbeatRun(
  input: HeartbeatRunInput
): Promise<HeartbeatRunResult> {
  const startMs = Date.now();
  let seq = 0;
  let checkpointSeq = 0;
  let runtimeConfigRaw = "{}";

  // 1. Create HeartbeatRun (or attach to one created by the daemon scheduler)
  let runId = input.runId;
  if (runId) {
    await prisma.heartbeatRun.update({
      where: { id: runId },
      data: {
        wakeupRequestId: input.wakeupRequestId ?? null,
        invocationSource: input.invocationSource ?? "on_demand",
        contextSnapshot: input.contextSnapshot
          ? JSON.stringify(input.contextSnapshot)
          : undefined,
      },
    });
  } else {
    const run = await prisma.heartbeatRun.create({
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
    ? await prisma.agentWakeupRequest.findUnique({
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

  const persistCheckpoint = async (
    stepKey: string,
    checkpointType: string,
    state: Record<string, unknown>
  ) => {
    try {
      await createHeartbeatRunCheckpoint({
        runId,
        seq: checkpointSeq++,
        stepKey,
        checkpointType,
        state,
      });
    } catch (checkpointError) {
      logger.warn("heartbeat-executor: failed to persist checkpoint", {
        runId,
        stepKey,
        error: String(checkpointError),
      });
    }
  };

  await persistCheckpoint("run.created", "run_state", {
    task:
      input.task ??
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
      await prisma.heartbeatRun.update({
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
      broadcastSSE("agent_budget_exceeded", {
        agentId: input.agentId,
        runId,
        spent: budget.spent,
        budget: budget.budget,
      });
      try {
        const budgetAgent = await prisma.agent.findUnique({
          where: { id: input.agentId },
          select: { name: true, runtimeConfig: true },
        });
        if (budgetAgent) {
          const rc = parseTelegramChatId(budgetAgent.runtimeConfig);
          if (rc) {
            await sendBudgetWarningTelegram(rc, budgetAgent.name, budget.spent, budget.budget);
          }
        }
      } catch {
        // Ignore notification failures for budget warnings.
      }

      const retryDecision = wakeupRequest
        ? await applyWakeupFailure({
            wakeupRequest,
            workspaceId: input.workspaceId,
            runId,
            error: budgetError,
            prismaClient: prisma,
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
    const agent = await prisma.agent.findUniqueOrThrow({
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
      await prisma.heartbeatRun.update({
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

    const circuitSnapshot = await ensureAgentCircuitReady(
      input.agentId,
      agent.runtimeConfig
    );
    await persistCheckpoint("circuit.ready", "run_state", {
      circuitState: circuitSnapshot.state,
      circuitOpenUntil: circuitSnapshot.openUntil?.toISOString() ?? null,
      contextSnapshot: baseContextSnapshot,
    });

    // 4. Mark running
    await prisma.heartbeatRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date() },
    });
    await setAgentStatus(input.agentId, "running");
    await addRunEvent(runId, "start", "Heartbeat run started", seq++);
    await persistCheckpoint("run.started", "run_state", {
      task:
        input.task ??
        (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
      invocationSource: input.invocationSource ?? "on_demand",
      contextSnapshot: baseContextSnapshot,
    });

    await syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
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
    let result: {
      content: string;
      tokens: number;
      costUsd: number;
      model: string;
      provider: string;
    };

    if (agent.adapterType === "internal") {
      result = await executeInternal(agent, input.task, runId, (step) => {
        addRunEvent(runId, "step", step, seq++).catch(() => {});
      });
    } else {
      const adapter = getAdapter(agent.adapterType);
      if (adapter) {
        let adapterConfig: Record<string, unknown> = {};
        try {
          const rawConfig = await resolveSecretRefs(
            agent.adapterConfig || "{}",
            input.workspaceId
          );
          adapterConfig = JSON.parse(rawConfig);
        } catch {
          adapterConfig = {};
        }

        const prompt = buildAgentPrompt(agent, input.task);
        const adapterResult = await adapter.execute({
          agentId: agent.id,
          prompt,
          config: adapterConfig,
          onEvent: (event) => {
            addRunEvent(runId, "step", event, seq++).catch(() => {});
          },
        });
        result = {
          content: adapterResult.content,
          tokens: adapterResult.tokens,
          costUsd: adapterResult.costUsd,
          model: adapterResult.model,
          provider: adapterResult.provider,
        };
      } else {
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

    await prisma.heartbeatRun.update({
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

    await addRunEvent(
      runId,
      "completed",
      `Finished in ${durationMs}ms, ${result.tokens} tokens`,
      seq++
    );
    await persistCheckpoint("run.completed", "result", {
      task:
        input.task ??
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
    await recordAgentCircuitSuccess(input.agentId);

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
      await prisma.agent.update({
        where: { id: input.agentId },
        data: { spentMonthlyCents: { increment: costCents } },
      });
    }

    // 9. Track in AIRunCost for unified reporting
    try {
      await prisma.aIRunCost.create({
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
    } catch (costError) {
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

    await sendTelegramIfConfigured(agent, {
      agentName: agent.name,
      runId,
      status: "succeeded",
      durationMs,
      tokenCount: result.tokens,
      costCents,
      summary: result.content.slice(0, 500),
    });

    await syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
      logger.warn("heartbeat-executor: failed to sync workflow step after success", {
        runId,
        error: String(workflowError),
      });
    });

    if (input.wakeupRequestId) {
      await prisma.agentWakeupRequest
        .update({
          where: { id: input.wakeupRequestId },
          data: { status: "processed", processedAt: new Date() },
        })
        .catch(() => {});
    }

    return {
      runId,
      status: "succeeded",
      durationMs,
      content: result.content,
      tokens: result.tokens,
      costUsd: result.costUsd,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startMs;
    const errMsg = getErrorMessage(error, "Heartbeat execution failed");
    const classification = classifyOrchestrationFailure(error);
    const circuitSnapshot =
      error instanceof AgentCircuitOpenError
        ? {
            state: "open" as const,
            consecutiveFailures: 0,
            openedAt: null,
            openUntil: error.openUntil ?? null,
          }
        : await recordAgentCircuitFailure(input.agentId, runtimeConfigRaw);

    await prisma.heartbeatRun
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
      .catch(() => {});

    await addRunEvent(runId, "error", errMsg, seq++).catch(() => {});
    await persistCheckpoint("run.failed", "failure", {
      task:
        input.task ??
        (typeof baseContextSnapshot.task === "string" ? baseContextSnapshot.task : null),
      contextSnapshot: baseContextSnapshot,
      error: errMsg,
      errorType: classification.errorType,
    });

    const retryDecision = wakeupRequest
      ? await applyWakeupFailure({
          wakeupRequest,
          workspaceId: input.workspaceId,
          runId,
          runtimeConfig: runtimeConfigRaw,
          error,
          prismaClient: prisma,
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
    await setAgentStatus(
      input.agentId,
      retryDecision?.kind === "requeue" && circuitSnapshot.state !== "open"
        ? "idle"
        : "error"
    );

    broadcastSSE("agent_run_failed", {
      agentId: input.agentId,
      runId,
      error: errMsg,
      nextRetryAt: retryDecision?.nextRetryAt?.toISOString() ?? null,
      deadLettered: retryDecision?.kind === "dead_letter",
    });

    try {
      const failedAgent = await prisma.agent.findUnique({
        where: { id: input.agentId },
        select: { name: true, runtimeConfig: true },
      });
      if (failedAgent) {
        await sendTelegramIfConfigured(
          { ...failedAgent, runtimeConfig: failedAgent.runtimeConfig },
          {
            agentName: failedAgent.name,
            runId,
            status: "failed",
            durationMs,
            tokenCount: 0,
            costCents: 0,
            summary: null,
            errorMessage: errMsg,
          }
        );
      }
    } catch {
      // Ignore notification failures on failed runs.
    }

    logger.error("heartbeat-executor: run failed", {
      runId,
      agentId: input.agentId,
      error: errMsg,
    });

    await syncWorkflowStepFromHeartbeatRun(runId).catch((workflowError) => {
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
      nextRetryAt: retryDecision?.nextRetryAt?.toISOString(),
      deadLettered: retryDecision?.kind === "dead_letter",
    };
  }
}

// ── Internal adapter (uses existing CEOClaw execution engine) ──

async function executeInternal(
  agent: {
    id: string;
    name: string;
    slug: string;
    role: string;
    definitionId: string | null;
    runtimeConfig: string;
  },
  task: string | undefined,
  runId: string,
  onStep: (step: string) => void
): Promise<{
  content: string;
  tokens: number;
  costUsd: number;
  model: string;
  provider: string;
}> {
  // Dynamic import to keep this module edge-compatible when possible
  const { improvedExecutor } = await import("@/lib/agents/agent-improvements");

  const runtimeConfig = parseRuntimeConfig(agent.runtimeConfig);

  const prompt = buildAgentPrompt(
    agent,
    task ?? "Perform your scheduled duties. Check pending tasks and provide updates."
  );

  const executionResult = await improvedExecutor.execute(
    agent.definitionId ?? agent.slug,
    prompt,
    {
      projectId: undefined,
      memory: [],
      metadata: {
        heartbeatRunId: runId,
        agentDbId: agent.id,
        timestamp: new Date().toISOString(),
      },
    },
    {
      retry: { maxRetries: 2 },
      fallback: { enabled: true },
      timeout: (runtimeConfig.timeoutSec ?? 120) * 1000,
      saveToMemory: true,
      onProgress: (progress) => {
        onStep(`${progress.stage}: ${progress.message}`);
      },
    }
  );

  if (!executionResult.success) {
    throw new Error(executionResult.error ?? "Agent execution failed");
  }

  return {
    content: executionResult.content,
    tokens: executionResult.tokens,
    costUsd: executionResult.cost,
    model: executionResult.model,
    provider: executionResult.provider,
  };
}

// ── Telegram integration helpers ───────────────────────────

function parseTelegramChatId(runtimeConfig: string): string | null {
  try {
    const rc = JSON.parse(runtimeConfig || "{}");
    return rc.telegramChatId ?? null;
  } catch {
    return null;
  }
}

async function sendTelegramIfConfigured(
  agent: { runtimeConfig: string },
  notification: {
    agentName: string;
    runId: string;
    status: "succeeded" | "failed" | "timed_out";
    durationMs: number;
    tokenCount: number;
    costCents: number;
    summary: string | null;
    errorMessage?: string;
  }
) {
  const chatId = parseTelegramChatId(agent.runtimeConfig);
  if (!chatId) return;
  try {
    await sendHeartbeatTelegramNotification(chatId, notification);
  } catch (e) {
    logger.warn("telegram-notify: failed", { error: String(e) });
  }
}

// ── Process wakeup queue ───────────────────────────────────

export async function processWakeupQueue(limit = 5): Promise<number> {
  const requests = await prisma.agentWakeupRequest.findMany({
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
      await prisma.agentWakeupRequest.update({
        where: { id: req.id },
        data: { status: "skipped", processedAt: new Date() },
      });
      continue;
    }

    let triggerData: Record<string, unknown> = {};
    try {
      triggerData = JSON.parse(req.triggerData || "{}");
    } catch { /* empty */ }

    await executeHeartbeatRun({
      runId:
        typeof triggerData.runId === "string" && triggerData.runId.trim()
          ? triggerData.runId
          : undefined,
      agentId: req.agentId,
      workspaceId: req.agent.workspaceId,
      wakeupRequestId: req.id,
      invocationSource: req.reason,
      task: (triggerData.task as string) ?? undefined,
      contextSnapshot: triggerData,
    });

    processed++;
  }

  return processed;
}
