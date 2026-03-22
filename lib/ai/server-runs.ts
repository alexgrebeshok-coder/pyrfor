import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyAIProposal, hasPendingProposal } from "@/lib/ai/action-engine";
import { executeCollaborativeRun, shouldUseCollaborativeRun } from "@/lib/ai/multi-agent-runtime";
import type { AIApplyProposalInput, AIRunInput, AIRunRecord, AIRunResult } from "@/lib/ai/types";
import { buildMockFinalRun } from "@/lib/ai/mock-adapter";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/server/runtime-mode";
import { logger } from "@/lib/logger";

export type ServerAIRunOrigin = "gateway" | "provider" | "mock";
export type ServerAIExecutionMode = ServerAIRunOrigin | "unavailable";

export type ServerAIStatus = {
  mode: ServerAIExecutionMode;
  gatewayKind: "local" | "remote" | "missing";
  gatewayAvailable: boolean;
  providerAvailable: boolean;
  isProduction: boolean;
  unavailableReason: string | null;
};

export type ServerAIRunEntry = {
  origin: ServerAIRunOrigin;
  input: AIRunInput;
  run: AIRunRecord;
};

const RUN_CACHE_DIR = path.join(process.cwd(), ".ceoclaw-cache", "ai-runs");

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export function isAIUnavailableError(error: unknown): error is AIUnavailableError {
  return error instanceof AIUnavailableError;
}

function cloneRun(run: AIRunRecord) {
  return JSON.parse(JSON.stringify(run)) as AIRunRecord;
}

function createRunId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ai-run-${crypto.randomUUID()}`;
  }

  return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
}

function createQueuedGatewayRun(input: AIRunInput, runId: string): AIRunRecord {
  const now = new Date().toISOString();

  return {
    id: runId,
    sessionId: input.sessionId,
    agentId: input.agent.id,
    title: "AI Workspace Run",
    prompt: input.prompt,
    quickActionId: input.quickAction?.id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    context: input.context?.activeContext || input.context || { projectId: "default" },
  };
}

export function hasOpenClawGateway() {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  return Boolean(gatewayUrl);
}

function getGatewayKind() {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  if (!gatewayUrl) {
    return "missing" as const;
  }

  try {
    const parsed = new URL(gatewayUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return "local" as const;
    }
    return "remote" as const;
  } catch {
    return /localhost|127\.0\.0\.1|::1/i.test(gatewayUrl) ? ("local" as const) : ("remote" as const);
  }
}

function hasAvailableProvider() {
  return !!(
    process.env.AIJORA_API_KEY ||
    process.env.POLZA_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.BOTHUB_API_KEY ||
    process.env.ZAI_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

function getExecutionMode(): "gateway" | "provider" | "mock" {
  const mode = process.env.SEOCLAW_AI_MODE;
  const isProduction = process.env.NODE_ENV === "production";
  const gatewayAvailable = hasOpenClawGateway();
  const providerAvailable = hasAvailableProvider();

  // Explicit mode set
  if (mode === "mock") {
    if (isProduction) {
      throw new AIUnavailableError("Mock AI mode is disabled in production.");
    }

    return "mock";
  }

  if (mode === "gateway") {
    if (gatewayAvailable) return "gateway";
    if (providerAvailable) {
      if (!isProduction) {
        logger.warn("SEOCLAW_AI_MODE=gateway but no gateway configured, using provider instead");
      }
      return "provider";
    }
    if (isProduction) {
      throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
    }
    logger.warn("SEOCLAW_AI_MODE=gateway but no gateway configured, falling back to provider/mock");
  }

  if (mode === "provider") {
    if (providerAvailable) return "provider";
    if (gatewayAvailable) {
      if (!isProduction) {
        logger.warn("SEOCLAW_AI_MODE=provider but no provider configured, using gateway instead");
      }
      return "gateway";
    }
    if (isProduction) {
      throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
    }
    logger.warn("SEOCLAW_AI_MODE=provider but no provider configured, falling back to mock");
  }

  // Auto-detect
  if (gatewayAvailable) return "gateway";
  if (providerAvailable) return "provider";
  if (isProduction) {
    throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
  }
  return "mock";
}

export function getServerAIStatus(): ServerAIStatus {
  const gatewayAvailable = hasOpenClawGateway();
  const providerAvailable = hasAvailableProvider();
  const isProduction = process.env.NODE_ENV === "production";

  try {
    return {
      mode: getExecutionMode(),
      gatewayKind: getGatewayKind(),
      gatewayAvailable,
      providerAvailable,
      isProduction,
      unavailableReason: null,
    };
  } catch (error) {
    if (error instanceof AIUnavailableError) {
      return {
        mode: "unavailable",
        gatewayKind: getGatewayKind(),
        gatewayAvailable,
        providerAvailable,
        isProduction,
        unavailableReason: error.message,
      };
    }

    throw error;
  }
}

function getRunFile(runId: string) {
  return path.join(RUN_CACHE_DIR, `${runId}.json`);
}

export function buildReplayAIRunInput(entry: ServerAIRunEntry): AIRunInput {
  const source = entry.input.source;

  return {
    ...entry.input,
    source: source
      ? {
          ...source,
          replayOfRunId: entry.run.id,
          replayReason: source.replayReason ?? "manual_replay",
        }
      : {
          workflow: "ai_run_replay",
          entityType: "ai_run",
          entityId: entry.run.id,
          entityLabel: entry.run.title,
          replayOfRunId: entry.run.id,
          replayReason: "manual_replay",
        },
  };
}

async function persistEntry(entry: ServerAIRunEntry) {
  if (shouldUseDatabaseRunStore()) {
    const ledgerRow = serializeLedgerRow(entry);
    await prisma.aiRunLedger.upsert({
      where: { id: entry.run.id },
      create: ledgerRow,
      update: {
        origin: ledgerRow.origin,
        agentId: ledgerRow.agentId,
        title: ledgerRow.title,
        status: ledgerRow.status,
        quickActionId: ledgerRow.quickActionId,
        projectId: ledgerRow.projectId,
        workflow: ledgerRow.workflow,
        sourceEntityType: ledgerRow.sourceEntityType,
        sourceEntityId: ledgerRow.sourceEntityId,
        inputJson: ledgerRow.inputJson,
        runJson: ledgerRow.runJson,
        runCreatedAt: ledgerRow.runCreatedAt,
        runUpdatedAt: ledgerRow.runUpdatedAt,
        updatedAt: ledgerRow.updatedAt,
      },
    });
    return;
  }

  await mkdir(RUN_CACHE_DIR, { recursive: true });
  await writeFile(getRunFile(entry.run.id), JSON.stringify(entry), "utf8");
}

async function readEntry(runId: string) {
  if (shouldUseDatabaseRunStore()) {
    const record = await prisma.aiRunLedger.findUnique({
      where: { id: runId },
    });
    return record ? deserializeLedgerRow(record) : null;
  }

  try {
    const payload = await readFile(getRunFile(runId), "utf8");
    return JSON.parse(payload) as ServerAIRunEntry;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function listRunIds() {
  if (shouldUseDatabaseRunStore()) {
    const rows = await prisma.aiRunLedger.findMany({
      select: { id: true },
      orderBy: [{ runCreatedAt: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((row) => row.id);
  }

  try {
    const filenames = await readdir(RUN_CACHE_DIR, { withFileTypes: true });
    return filenames
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/, ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return [];
    }
    throw error;
  }
}

function cloneEntry(entry: ServerAIRunEntry) {
  return JSON.parse(JSON.stringify(entry)) as ServerAIRunEntry;
}

async function createMockRun(input: AIRunInput) {
  const runId = createRunId();
  const run = createQueuedGatewayRun(input, runId);
  await persistEntry({
    origin: "mock",
    input,
    run,
  });
  return run;
}

async function createProviderRun(input: AIRunInput) {
  const runId = createRunId();
  const run = createQueuedGatewayRun(input, runId);
  await persistEntry({
    origin: "provider",
    input,
    run,
  });
  void executeProviderRun(runId);
  return cloneRun(run);
}

async function executeProviderRun(runId: string) {
  await executeLiveRun(runId, "provider");
}

async function executeGatewayRun(runId: string) {
  await executeLiveRun(runId, "gateway");
}

async function executeLiveRun(runId: string, strategy: "gateway" | "provider") {
  const entry = await readEntry(runId);
  if (!entry) return;

  const runningAt = new Date().toISOString();
  await persistEntry({
    ...entry,
    run: {
      ...entry.run,
      status: "running",
      updatedAt: runningAt,
    },
  });

  try {
    const result: AIRunResult = await executeCollaborativeRun(entry.input, runId, strategy, {
      forceCollaborative: strategy === "gateway" ? shouldUseCollaborativeRun(entry.input) : false,
    });

    const finalRun: AIRunRecord = {
      ...entry.run,
      status: hasPendingProposal(result) ? "needs_approval" : "done",
      updatedAt: new Date().toISOString(),
      result,
    };

    await persistEntry({
      ...entry,
      run: finalRun,
    });
  } catch (error) {
    logger.error(`${strategy} run failed`, { runId, error: error instanceof Error ? error.message : String(error) });

    const failedRun: AIRunRecord = {
      ...entry.run,
      status: "failed",
      updatedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : "Provider error",
    };

    await persistEntry({
      ...entry,
      run: failedRun,
    });
  }
}

async function resolveServerAIRunEntry(runId: string) {
  const entry = await readEntry(runId);
  if (!entry) {
    throw new Error(`AI run ${runId} not found`);
  }

  if (entry.origin === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new AIUnavailableError("Mock AI runs are unavailable in production.");
    }

    const nextEntry = resolveMockRunEntry(entry);
    if (hasEntryChanged(entry, nextEntry)) {
      await persistEntry(nextEntry);
    }
    return nextEntry;
  }

  return entry;
}

/**
 * Ensure AI run context has the required array fields.
 * The frontend `buildSnapshot()` always provides them, but external callers
 * or stale clients might omit them, causing downstream crashes.
 */
function normalizeRunContext(input: AIRunInput): AIRunInput {
  const ctx = input.context ?? {};
  return {
    ...input,
    context: {
      ...ctx,
      projects: Array.isArray(ctx.projects) ? ctx.projects : [],
      tasks: Array.isArray(ctx.tasks) ? ctx.tasks : [],
      risks: Array.isArray(ctx.risks) ? ctx.risks : [],
      team: Array.isArray(ctx.team) ? ctx.team : [],
      notifications: Array.isArray(ctx.notifications) ? ctx.notifications : [],
      activeContext: ctx.activeContext ?? { title: "", subtitle: "" },
    },
  };
}

export async function createServerAIRun(rawInput: AIRunInput) {
  const input = normalizeRunContext(rawInput);
  const mode = getExecutionMode();

  if (mode === "mock") {
    return createMockRun(input);
  }

  if (mode === "provider") {
    return createProviderRun(input);
  }

  // Gateway mode
  const runId = createRunId();
  const run = createQueuedGatewayRun(input, runId);
  await persistEntry({
    origin: "gateway",
    input,
    run,
  });
  void executeGatewayRun(runId);
  return cloneRun(run);
}

export async function getServerAIRun(runId: string) {
  const entry = await resolveServerAIRunEntry(runId);
  return cloneRun(entry.run);
}

export async function getServerAIRunEntry(runId: string) {
  const entry = await resolveServerAIRunEntry(runId);
  return cloneEntry(entry);
}

export async function listServerAIRunEntries() {
  const runIds = await listRunIds();
  const entries = await Promise.all(
    runIds.map(async (runId) => {
      try {
        return await resolveServerAIRunEntry(runId);
      } catch {
        return null;
      }
    })
  );

  return entries
    .filter((entry): entry is ServerAIRunEntry => entry !== null)
    .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
    .map(cloneEntry);
}

export async function applyServerAIProposal(input: AIApplyProposalInput) {
  const entry = await resolveServerAIRunEntry(input.runId);
  if (!entry) {
    throw new Error(`AI run ${input.runId} not found`);
  }

  const nextRun = applyAIProposal(entry.run, input.proposalId);
  await persistEntry({
    ...entry,
    run: nextRun,
  });

  return cloneRun(nextRun);
}

export async function replayServerAIRun(runId: string) {
  const entry = await getServerAIRunEntry(runId);
  const replayInput = buildReplayAIRunInput(entry);
  return createServerAIRun(replayInput);
}

function shouldUseDatabaseRunStore(env: NodeJS.ProcessEnv = process.env) {
  return isDatabaseConfigured(env);
}

function resolveMockRunEntry(entry: ServerAIRunEntry) {
  const elapsedMs = Date.now() - Date.parse(entry.run.createdAt);
  const nextUpdatedAt = new Date().toISOString();

  if (entry.run.result?.proposal || entry.run.result?.actionResult || entry.run.status === "done") {
    return entry;
  }

  if (elapsedMs < 550) {
    return entry;
  }

  if (elapsedMs < 1800) {
    if (entry.run.status === "running") {
      return entry;
    }

    return {
      ...entry,
      run: {
        ...entry.run,
        status: "running",
        updatedAt: nextUpdatedAt,
      },
    } satisfies ServerAIRunEntry;
  }

  const finalRun = buildMockFinalRun(entry.input, {
    id: entry.run.id,
    createdAt: entry.run.createdAt,
    updatedAt: nextUpdatedAt,
    quickActionId: entry.run.quickActionId,
  });

  return {
    ...entry,
    run: finalRun,
  } satisfies ServerAIRunEntry;
}

function hasEntryChanged(left: ServerAIRunEntry, right: ServerAIRunEntry) {
  return JSON.stringify(left.run) !== JSON.stringify(right.run);
}

function serializeLedgerRow(entry: ServerAIRunEntry) {
  return {
    id: entry.run.id,
    origin: entry.origin,
    agentId: entry.run.agentId,
    title: entry.run.title,
    status: entry.run.status,
    quickActionId: entry.run.quickActionId ?? null,
    projectId:
      entry.input.source?.projectId ??
      entry.input.context.project?.id ??
      entry.run.context.projectId ??
      null,
    workflow: entry.input.source?.workflow ?? null,
    sourceEntityType: entry.input.source?.entityType ?? null,
    sourceEntityId: entry.input.source?.entityId ?? null,
    inputJson: JSON.stringify(entry.input),
    runJson: JSON.stringify(entry.run),
    runCreatedAt: new Date(entry.run.createdAt),
    runUpdatedAt: new Date(entry.run.updatedAt),
    updatedAt: new Date(),
  };
}

function deserializeLedgerRow(row: {
  id: string;
  origin: string;
  inputJson: string;
  runJson: string;
}) {
  return {
    origin: row.origin as ServerAIRunOrigin,
    input: JSON.parse(row.inputJson) as AIRunInput,
    run: JSON.parse(row.runJson) as AIRunRecord,
  } satisfies ServerAIRunEntry;
}
