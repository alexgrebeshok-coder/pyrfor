"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIUnavailableError = void 0;
exports.isAIUnavailableError = isAIUnavailableError;
exports.hasOpenClawGateway = hasOpenClawGateway;
exports.getServerAIStatus = getServerAIStatus;
exports.buildReplayAIRunInput = buildReplayAIRunInput;
exports.createServerAIRun = createServerAIRun;
exports.getServerAIRun = getServerAIRun;
exports.getServerAIRunEntry = getServerAIRunEntry;
exports.listServerAIRunEntries = listServerAIRunEntries;
exports.applyServerAIProposal = applyServerAIProposal;
exports.replayServerAIRun = replayServerAIRun;
require("server-only");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const action_engine_1 = require("./action-engine");
const proposal_apply_executor_1 = require("./proposal-apply-executor");
const multi_agent_runtime_1 = require("./multi-agent-runtime");
const mock_adapter_1 = require("./mock-adapter");
const prisma_1 = require("../prisma");
const runtime_mode_1 = require("../config/runtime-mode");
const logger_1 = require("../observability/logger");
const RUN_CACHE_DIR = node_path_1.default.join(process.cwd(), ".ceoclaw-cache", "ai-runs");
class AIUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = "AIUnavailableError";
    }
}
exports.AIUnavailableError = AIUnavailableError;
function isAIUnavailableError(error) {
    return error instanceof AIUnavailableError;
}
function cloneRun(run) {
    return JSON.parse(JSON.stringify(run));
}
function createRunId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `ai-run-${crypto.randomUUID()}`;
    }
    return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
}
function createQueuedGatewayRun(input, runId) {
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
function hasOpenClawGateway() {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
    return Boolean(gatewayUrl);
}
function getGatewayKind() {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
    if (!gatewayUrl) {
        return "missing";
    }
    try {
        const parsed = new URL(gatewayUrl);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
            return "local";
        }
        return "remote";
    }
    catch {
        return /localhost|127\.0\.0\.1|::1/i.test(gatewayUrl) ? "local" : "remote";
    }
}
function hasAvailableProvider() {
    return !!(process.env.AIJORA_API_KEY ||
        process.env.POLZA_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.BOTHUB_API_KEY ||
        process.env.ZAI_API_KEY ||
        process.env.OPENAI_API_KEY);
}
function getExecutionMode() {
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
        if (gatewayAvailable)
            return "gateway";
        if (providerAvailable) {
            if (!isProduction) {
                logger_1.logger.warn("SEOCLAW_AI_MODE=gateway but no gateway configured, using provider instead");
            }
            return "provider";
        }
        if (isProduction) {
            throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
        }
        logger_1.logger.warn("SEOCLAW_AI_MODE=gateway but no gateway configured, falling back to provider/mock");
    }
    if (mode === "provider") {
        if (providerAvailable)
            return "provider";
        if (gatewayAvailable) {
            if (!isProduction) {
                logger_1.logger.warn("SEOCLAW_AI_MODE=provider but no provider configured, using gateway instead");
            }
            return "gateway";
        }
        if (isProduction) {
            throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
        }
        logger_1.logger.warn("SEOCLAW_AI_MODE=provider but no provider configured, falling back to mock");
    }
    // Auto-detect
    if (gatewayAvailable)
        return "gateway";
    if (providerAvailable)
        return "provider";
    if (isProduction) {
        throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
    }
    return "mock";
}
function getServerAIStatus() {
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
    }
    catch (error) {
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
function getRunFile(runId) {
    return node_path_1.default.join(RUN_CACHE_DIR, `${runId}.json`);
}
function buildReplayAIRunInput(entry) {
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
async function persistEntry(entry) {
    if (shouldUseDatabaseRunStore()) {
        const ledgerRow = serializeLedgerRow(entry);
        await prisma_1.prisma.aiRunLedger.upsert({
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
    await (0, promises_1.mkdir)(RUN_CACHE_DIR, { recursive: true });
    await (0, promises_1.writeFile)(getRunFile(entry.run.id), JSON.stringify(entry), "utf8");
}
async function readEntry(runId) {
    if (shouldUseDatabaseRunStore()) {
        const record = await prisma_1.prisma.aiRunLedger.findUnique({
            where: { id: runId },
        });
        return record ? deserializeLedgerRow(record) : null;
    }
    try {
        const payload = await (0, promises_1.readFile)(getRunFile(runId), "utf8");
        return JSON.parse(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENOENT")) {
            return null;
        }
        throw error;
    }
}
async function listRunIds() {
    if (shouldUseDatabaseRunStore()) {
        const rows = await prisma_1.prisma.aiRunLedger.findMany({
            select: { id: true },
            orderBy: [{ runCreatedAt: "desc" }, { createdAt: "desc" }],
        });
        return rows.map((row) => row.id);
    }
    try {
        const filenames = await (0, promises_1.readdir)(RUN_CACHE_DIR, { withFileTypes: true });
        return filenames
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name.replace(/\.json$/, ""));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENOENT")) {
            return [];
        }
        throw error;
    }
}
function cloneEntry(entry) {
    return JSON.parse(JSON.stringify(entry));
}
async function createMockRun(input) {
    const runId = createRunId();
    const run = createQueuedGatewayRun(input, runId);
    await persistEntry({
        origin: "mock",
        input,
        run,
    });
    return run;
}
async function createProviderRun(input) {
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
async function executeProviderRun(runId) {
    await executeLiveRun(runId, "provider");
}
async function executeGatewayRun(runId) {
    await executeLiveRun(runId, "gateway");
}
async function executeLiveRun(runId, strategy) {
    const entry = await readEntry(runId);
    if (!entry)
        return;
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
        const result = await (0, multi_agent_runtime_1.executeCollaborativeRun)(entry.input, runId, strategy, {
            forceCollaborative: strategy === "gateway" ? (0, multi_agent_runtime_1.shouldUseCollaborativeRun)(entry.input) : false,
        });
        const finalRun = {
            ...entry.run,
            status: (0, action_engine_1.hasPendingProposal)(result) ? "needs_approval" : "done",
            updatedAt: new Date().toISOString(),
            result,
        };
        await persistEntry({
            ...entry,
            run: finalRun,
        });
    }
    catch (error) {
        logger_1.logger.error(`${strategy} run failed`, { runId, error: error instanceof Error ? error.message : String(error) });
        const failedRun = {
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
async function resolveServerAIRunEntry(runId) {
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
function normalizeRunContext(input) {
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
async function createServerAIRun(rawInput) {
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
async function getServerAIRun(runId) {
    const entry = await resolveServerAIRunEntry(runId);
    return cloneRun(entry.run);
}
async function getServerAIRunEntry(runId) {
    const entry = await resolveServerAIRunEntry(runId);
    return cloneEntry(entry);
}
async function listServerAIRunEntries() {
    const runIds = await listRunIds();
    const entries = await Promise.all(runIds.map(async (runId) => {
        try {
            return await resolveServerAIRunEntry(runId);
        }
        catch {
            return null;
        }
    }));
    return entries
        .filter((entry) => entry !== null)
        .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
        .map(cloneEntry);
}
async function applyServerAIProposal(input) {
    const entry = await resolveServerAIRunEntry(input.runId);
    if (!entry) {
        throw new Error(`AI run ${input.runId} not found`);
    }
    const executedRun = await (0, proposal_apply_executor_1.executeServerAIProposalApply)(entry.run, input);
    const nextRun = executedRun ?? (0, action_engine_1.applyAIProposal)(entry.run, input.proposalId);
    await persistEntry({
        ...entry,
        run: nextRun,
    });
    return cloneRun(nextRun);
}
async function replayServerAIRun(runId) {
    const entry = await getServerAIRunEntry(runId);
    const replayInput = buildReplayAIRunInput(entry);
    return createServerAIRun(replayInput);
}
function shouldUseDatabaseRunStore(env = process.env) {
    return (0, runtime_mode_1.isDatabaseConfigured)(env);
}
function resolveMockRunEntry(entry) {
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
        };
    }
    const finalRun = (0, mock_adapter_1.buildMockFinalRun)(entry.input, {
        id: entry.run.id,
        createdAt: entry.run.createdAt,
        updatedAt: nextUpdatedAt,
        quickActionId: entry.run.quickActionId,
    });
    return {
        ...entry,
        run: finalRun,
    };
}
function hasEntryChanged(left, right) {
    return JSON.stringify(left.run) !== JSON.stringify(right.run);
}
function serializeLedgerRow(entry) {
    return {
        id: entry.run.id,
        origin: entry.origin,
        agentId: entry.run.agentId,
        title: entry.run.title,
        status: entry.run.status,
        quickActionId: entry.run.quickActionId ?? null,
        projectId: entry.input.source?.projectId ??
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
function deserializeLedgerRow(row) {
    return {
        origin: row.origin,
        input: JSON.parse(row.inputJson),
        run: JSON.parse(row.runJson),
    };
}
