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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyAIProposal, hasPendingProposal } from './action-engine.js';
import { executeServerAIProposalApply } from './proposal-apply-executor.js';
import { executeCollaborativeRun, shouldUseCollaborativeRun } from './multi-agent-runtime.js';
import { buildMockFinalRun } from './mock-adapter.js';
import { prisma } from '../prisma.js';
import { isDatabaseConfigured } from '../config/runtime-mode.js';
import { logger } from '../observability/logger.js';
const RUN_CACHE_DIR = path.join(process.cwd(), ".ceoclaw-cache", "ai-runs");
export class AIUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = "AIUnavailableError";
    }
}
export function isAIUnavailableError(error) {
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
    var _a, _b;
    const now = new Date().toISOString();
    return {
        id: runId,
        sessionId: input.sessionId,
        agentId: input.agent.id,
        title: "AI Workspace Run",
        prompt: input.prompt,
        quickActionId: (_a = input.quickAction) === null || _a === void 0 ? void 0 : _a.id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        context: ((_b = input.context) === null || _b === void 0 ? void 0 : _b.activeContext) || input.context || { projectId: "default" },
    };
}
export function hasOpenClawGateway() {
    var _a;
    const gatewayUrl = (_a = process.env.OPENCLAW_GATEWAY_URL) === null || _a === void 0 ? void 0 : _a.trim();
    return Boolean(gatewayUrl);
}
function getGatewayKind() {
    var _a;
    const gatewayUrl = (_a = process.env.OPENCLAW_GATEWAY_URL) === null || _a === void 0 ? void 0 : _a.trim();
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
    catch (_b) {
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
        if (providerAvailable)
            return "provider";
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
    if (gatewayAvailable)
        return "gateway";
    if (providerAvailable)
        return "provider";
    if (isProduction) {
        throw new AIUnavailableError("No live AI provider is configured for production AI runs.");
    }
    return "mock";
}
export function getServerAIStatus() {
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
    return path.join(RUN_CACHE_DIR, `${runId}.json`);
}
export function buildReplayAIRunInput(entry) {
    var _a;
    const source = entry.input.source;
    return Object.assign(Object.assign({}, entry.input), { source: source
            ? Object.assign(Object.assign({}, source), { replayOfRunId: entry.run.id, replayReason: (_a = source.replayReason) !== null && _a !== void 0 ? _a : "manual_replay" }) : {
            workflow: "ai_run_replay",
            entityType: "ai_run",
            entityId: entry.run.id,
            entityLabel: entry.run.title,
            replayOfRunId: entry.run.id,
            replayReason: "manual_replay",
        } });
}
function persistEntry(entry) {
    return __awaiter(this, void 0, void 0, function* () {
        if (shouldUseDatabaseRunStore()) {
            const ledgerRow = serializeLedgerRow(entry);
            yield prisma.aiRunLedger.upsert({
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
        yield mkdir(RUN_CACHE_DIR, { recursive: true });
        yield writeFile(getRunFile(entry.run.id), JSON.stringify(entry), "utf8");
    });
}
function readEntry(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (shouldUseDatabaseRunStore()) {
            const record = yield prisma.aiRunLedger.findUnique({
                where: { id: runId },
            });
            return record ? deserializeLedgerRow(record) : null;
        }
        try {
            const payload = yield readFile(getRunFile(runId), "utf8");
            return JSON.parse(payload);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("ENOENT")) {
                return null;
            }
            throw error;
        }
    });
}
function listRunIds() {
    return __awaiter(this, void 0, void 0, function* () {
        if (shouldUseDatabaseRunStore()) {
            const rows = yield prisma.aiRunLedger.findMany({
                select: { id: true },
                orderBy: [{ runCreatedAt: "desc" }, { createdAt: "desc" }],
            });
            return rows.map((row) => row.id);
        }
        try {
            const filenames = yield readdir(RUN_CACHE_DIR, { withFileTypes: true });
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
    });
}
function cloneEntry(entry) {
    return JSON.parse(JSON.stringify(entry));
}
function createMockRun(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const runId = createRunId();
        const run = createQueuedGatewayRun(input, runId);
        yield persistEntry({
            origin: "mock",
            input,
            run,
        });
        return run;
    });
}
function createProviderRun(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const runId = createRunId();
        const run = createQueuedGatewayRun(input, runId);
        yield persistEntry({
            origin: "provider",
            input,
            run,
        });
        void executeProviderRun(runId);
        return cloneRun(run);
    });
}
function executeProviderRun(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield executeLiveRun(runId, "provider");
    });
}
function executeGatewayRun(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield executeLiveRun(runId, "gateway");
    });
}
function executeLiveRun(runId, strategy) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield readEntry(runId);
        if (!entry)
            return;
        const runningAt = new Date().toISOString();
        yield persistEntry(Object.assign(Object.assign({}, entry), { run: Object.assign(Object.assign({}, entry.run), { status: "running", updatedAt: runningAt }) }));
        try {
            const result = yield executeCollaborativeRun(entry.input, runId, strategy, {
                forceCollaborative: strategy === "gateway" ? shouldUseCollaborativeRun(entry.input) : false,
            });
            const finalRun = Object.assign(Object.assign({}, entry.run), { status: hasPendingProposal(result) ? "needs_approval" : "done", updatedAt: new Date().toISOString(), result });
            yield persistEntry(Object.assign(Object.assign({}, entry), { run: finalRun }));
        }
        catch (error) {
            logger.error(`${strategy} run failed`, { runId, error: error instanceof Error ? error.message : String(error) });
            const failedRun = Object.assign(Object.assign({}, entry.run), { status: "failed", updatedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Provider error" });
            yield persistEntry(Object.assign(Object.assign({}, entry), { run: failedRun }));
        }
    });
}
function resolveServerAIRunEntry(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield readEntry(runId);
        if (!entry) {
            throw new Error(`AI run ${runId} not found`);
        }
        if (entry.origin === "mock") {
            if (process.env.NODE_ENV === "production") {
                throw new AIUnavailableError("Mock AI runs are unavailable in production.");
            }
            const nextEntry = resolveMockRunEntry(entry);
            if (hasEntryChanged(entry, nextEntry)) {
                yield persistEntry(nextEntry);
            }
            return nextEntry;
        }
        return entry;
    });
}
/**
 * Ensure AI run context has the required array fields.
 * The frontend `buildSnapshot()` always provides them, but external callers
 * or stale clients might omit them, causing downstream crashes.
 */
function normalizeRunContext(input) {
    var _a, _b;
    const ctx = (_a = input.context) !== null && _a !== void 0 ? _a : {};
    return Object.assign(Object.assign({}, input), { context: Object.assign(Object.assign({}, ctx), { projects: Array.isArray(ctx.projects) ? ctx.projects : [], tasks: Array.isArray(ctx.tasks) ? ctx.tasks : [], risks: Array.isArray(ctx.risks) ? ctx.risks : [], team: Array.isArray(ctx.team) ? ctx.team : [], notifications: Array.isArray(ctx.notifications) ? ctx.notifications : [], activeContext: (_b = ctx.activeContext) !== null && _b !== void 0 ? _b : { title: "", subtitle: "" } }) });
}
export function createServerAIRun(rawInput) {
    return __awaiter(this, void 0, void 0, function* () {
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
        yield persistEntry({
            origin: "gateway",
            input,
            run,
        });
        void executeGatewayRun(runId);
        return cloneRun(run);
    });
}
export function getServerAIRun(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield resolveServerAIRunEntry(runId);
        return cloneRun(entry.run);
    });
}
export function getServerAIRunEntry(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield resolveServerAIRunEntry(runId);
        return cloneEntry(entry);
    });
}
export function listServerAIRunEntries() {
    return __awaiter(this, void 0, void 0, function* () {
        const runIds = yield listRunIds();
        const entries = yield Promise.all(runIds.map((runId) => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield resolveServerAIRunEntry(runId);
            }
            catch (_a) {
                return null;
            }
        })));
        return entries
            .filter((entry) => entry !== null)
            .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
            .map(cloneEntry);
    });
}
export function applyServerAIProposal(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield resolveServerAIRunEntry(input.runId);
        if (!entry) {
            throw new Error(`AI run ${input.runId} not found`);
        }
        const executedRun = yield executeServerAIProposalApply(entry.run, input);
        const nextRun = executedRun !== null && executedRun !== void 0 ? executedRun : applyAIProposal(entry.run, input.proposalId);
        yield persistEntry(Object.assign(Object.assign({}, entry), { run: nextRun }));
        return cloneRun(nextRun);
    });
}
export function replayServerAIRun(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield getServerAIRunEntry(runId);
        const replayInput = buildReplayAIRunInput(entry);
        return createServerAIRun(replayInput);
    });
}
function shouldUseDatabaseRunStore(env = process.env) {
    return isDatabaseConfigured(env);
}
function resolveMockRunEntry(entry) {
    var _a, _b;
    const elapsedMs = Date.now() - Date.parse(entry.run.createdAt);
    const nextUpdatedAt = new Date().toISOString();
    if (((_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal) || ((_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.actionResult) || entry.run.status === "done") {
        return entry;
    }
    if (elapsedMs < 550) {
        return entry;
    }
    if (elapsedMs < 1800) {
        if (entry.run.status === "running") {
            return entry;
        }
        return Object.assign(Object.assign({}, entry), { run: Object.assign(Object.assign({}, entry.run), { status: "running", updatedAt: nextUpdatedAt }) });
    }
    const finalRun = buildMockFinalRun(entry.input, {
        id: entry.run.id,
        createdAt: entry.run.createdAt,
        updatedAt: nextUpdatedAt,
        quickActionId: entry.run.quickActionId,
    });
    return Object.assign(Object.assign({}, entry), { run: finalRun });
}
function hasEntryChanged(left, right) {
    return JSON.stringify(left.run) !== JSON.stringify(right.run);
}
function serializeLedgerRow(entry) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    return {
        id: entry.run.id,
        origin: entry.origin,
        agentId: entry.run.agentId,
        title: entry.run.title,
        status: entry.run.status,
        quickActionId: (_a = entry.run.quickActionId) !== null && _a !== void 0 ? _a : null,
        projectId: (_f = (_e = (_c = (_b = entry.input.source) === null || _b === void 0 ? void 0 : _b.projectId) !== null && _c !== void 0 ? _c : (_d = entry.input.context.project) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : entry.run.context.projectId) !== null && _f !== void 0 ? _f : null,
        workflow: (_h = (_g = entry.input.source) === null || _g === void 0 ? void 0 : _g.workflow) !== null && _h !== void 0 ? _h : null,
        sourceEntityType: (_k = (_j = entry.input.source) === null || _j === void 0 ? void 0 : _j.entityType) !== null && _k !== void 0 ? _k : null,
        sourceEntityId: (_m = (_l = entry.input.source) === null || _l === void 0 ? void 0 : _l.entityId) !== null && _m !== void 0 ? _m : null,
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
