"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiKernelControlPlane = exports.AIKernelControlPlane = exports.AI_KERNEL_OPERATIONS = void 0;
exports.isAIKernelOperation = isAIKernelOperation;
const node_crypto_1 = require("node:crypto");
const kernel_context_stack_1 = require("./kernel-context-stack");
const kernel_tool_plane_1 = require("./kernel-tool-plane");
const server_runs_1 = require("./server-runs");
const logger_1 = require("../observability/logger");
exports.AI_KERNEL_OPERATIONS = [
    "status",
    "run.create",
    "run.get",
    "run.list",
    "run.apply",
    "chat.context.build",
    "tool.list",
    "tool.execute",
];
class AIKernelRequestError extends Error {
    constructor(code, message, status = 400, details) {
        super(message);
        this.name = "AIKernelRequestError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}
const CHAT_ROLES = new Set(["system", "user", "assistant"]);
function isAIKernelOperation(value) {
    return typeof value === "string" && exports.AI_KERNEL_OPERATIONS.includes(value);
}
class AIKernelControlPlane {
    async execute(request, context = {}) {
        const correlationId = context.correlationId?.trim() || `kernel-${(0, node_crypto_1.randomUUID)()}`;
        const timestamp = new Date().toISOString();
        try {
            this.validate(request);
            const data = await this.dispatch(request, context);
            return {
                success: true,
                operation: request.operation,
                correlationId,
                timestamp,
                data: data,
            };
        }
        catch (error) {
            const normalizedError = normalizeKernelError(error);
            logger_1.logger.error("[AI Kernel] request failed", {
                operation: request.operation,
                correlationId,
                transport: context.transport ?? "internal",
                path: context.path,
                actor: context.actor,
                code: normalizedError.code,
                status: normalizedError.status,
                message: normalizedError.message,
            });
            return {
                success: false,
                operation: request.operation,
                correlationId,
                timestamp,
                error: normalizedError,
            };
        }
    }
    validate(request) {
        switch (request.operation) {
            case "status":
            case "run.list":
            case "tool.list":
                return;
            case "run.create":
                this.validateRunCreate(request.payload);
                return;
            case "run.get":
                this.validateRunLookup(request.payload);
                return;
            case "run.apply":
                this.validateRunApply(request.payload);
                return;
            case "chat.context.build":
                this.validateChatContextRequest(request.payload);
                return;
            case "tool.execute":
                this.validateToolExecuteRequest(request.payload);
                return;
            default: {
                const exhaustive = request;
                throw new AIKernelRequestError("UNSUPPORTED_OPERATION", `AI kernel operation is not supported: ${String(exhaustive)}`);
            }
        }
    }
    async dispatch(request, context = {}) {
        switch (request.operation) {
            case "status":
                return {
                    status: (0, server_runs_1.getServerAIStatus)(),
                    supportedOperations: exports.AI_KERNEL_OPERATIONS,
                };
            case "run.create": {
                const stamped = stampActorOntoRunInput(request.payload, context.actor);
                const run = await (0, server_runs_1.createServerAIRun)(stamped);
                return { run };
            }
            case "run.get": {
                const runId = request.payload.runId.trim();
                const entry = await (0, server_runs_1.getServerAIRunEntry)(runId);
                assertWorkspaceAccess(entry, context.actor);
                return { run: entry.run };
            }
            case "run.list": {
                const entries = await (0, server_runs_1.listServerAIRunEntries)();
                const scoped = filterEntriesByActor(entries, context.actor);
                return {
                    runs: scoped.map((entry) => entry.run),
                    count: scoped.length,
                };
            }
            case "run.apply": {
                const runId = request.payload.runId.trim();
                const entry = await (0, server_runs_1.getServerAIRunEntry)(runId);
                assertWorkspaceAccess(entry, context.actor);
                const run = await (0, server_runs_1.applyServerAIProposal)({
                    runId,
                    proposalId: request.payload.proposalId.trim(),
                    operatorId: request.payload.operatorId?.trim() || context.actor?.userId,
                });
                return { run };
            }
            case "chat.context.build": {
                return (0, kernel_context_stack_1.buildKernelChatContext)(request.payload);
            }
            case "tool.list": {
                const tools = (0, kernel_tool_plane_1.listAIKernelTools)();
                return {
                    tools,
                    count: tools.length,
                };
            }
            case "tool.execute": {
                return {
                    result: await (0, kernel_tool_plane_1.executeAIKernelTool)(request.payload),
                };
            }
            default: {
                const exhaustive = request;
                throw new AIKernelRequestError("UNSUPPORTED_OPERATION", `AI kernel operation is not supported: ${String(exhaustive)}`);
            }
        }
    }
    validateRunCreate(input) {
        if (!input?.prompt?.trim()) {
            throw new AIKernelRequestError("PROMPT_REQUIRED", "Prompt is required.");
        }
        if (!input.agent?.id) {
            throw new AIKernelRequestError("AGENT_REQUIRED", "Agent is required.");
        }
        if (!input.context) {
            throw new AIKernelRequestError("CONTEXT_REQUIRED", "Context is required.");
        }
    }
    validateRunLookup(input) {
        if (!input?.runId?.trim()) {
            throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
        }
    }
    validateRunApply(input) {
        if (!input?.runId?.trim()) {
            throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
        }
        if (!input?.proposalId?.trim()) {
            throw new AIKernelRequestError("PROPOSAL_ID_REQUIRED", "Proposal ID is required.");
        }
    }
    validateChatContextRequest(input) {
        if (!Array.isArray(input?.messages) || input.messages.length === 0) {
            throw new AIKernelRequestError("MESSAGES_REQUIRED", "At least one chat message is required.");
        }
        const invalidMessage = input.messages.find((message) => !message ||
            !CHAT_ROLES.has(message.role) ||
            typeof message.content !== "string" ||
            !message.content.trim());
        if (invalidMessage) {
            throw new AIKernelRequestError("MESSAGES_INVALID", "Chat messages must have a valid role and non-empty content.");
        }
    }
    validateToolExecuteRequest(input) {
        const validation = (0, kernel_tool_plane_1.validateAIKernelToolRequest)(input);
        if (validation.ok) {
            return;
        }
        switch (validation.code) {
            case "TOOL_NAME_REQUIRED":
            case "INVALID_TOOL_ARGUMENTS":
                throw new AIKernelRequestError(validation.code, validation.message, 400);
            case "UNKNOWN_TOOL":
                throw new AIKernelRequestError(validation.code, validation.message, 400, {
                    supportedTools: (0, kernel_tool_plane_1.listAIKernelTools)().map((tool) => tool.name),
                });
        }
    }
}
exports.AIKernelControlPlane = AIKernelControlPlane;
exports.aiKernelControlPlane = new AIKernelControlPlane();
/**
 * Stamp the actor context (workspace + user) onto the run input so downstream
 * persistence carries ownership metadata. The caller may not pass these fields
 * themselves; relying on actor context prevents clients from spoofing.
 */
function stampActorOntoRunInput(payload, actor) {
    const workspaceId = actor?.workspaceId;
    const ownerUserId = actor?.userId;
    if (!workspaceId && !ownerUserId) {
        return payload;
    }
    return {
        ...payload,
        ...(workspaceId && !payload.workspaceId ? { workspaceId } : {}),
        ...(ownerUserId && !payload.ownerUserId ? { ownerUserId } : {}),
    };
}
/**
 * Enforce that a caller from workspace X can only access runs created in
 * workspace X. Runs persisted before workspace tagging existed are treated as
 * accessible to any workspace (graceful backward compatibility) — new runs
 * created via the kernel will always be tagged.
 */
/**
 * Enforce workspace isolation on a run lookup.
 *
 * Behaviour for legacy "untagged" runs (created before Wave A, before
 * `workspaceId` was stamped onto `AIRunInput`) is controlled by
 * `AI_KERNEL_REJECT_LEGACY_UNTAGGED`:
 *   - `false` / unset (default)  → allow + log `workspace-untagged run accessed`.
 *   - `true`                      → reject with 403 `FORBIDDEN_WORKSPACE`.
 *
 * Run the backfill script (`scripts/backfill-ai-runs-workspace.ts`)
 * before flipping the flag on in production.
 */
function assertWorkspaceAccess(entry, actor) {
    const actorWs = actor?.workspaceId;
    if (!actorWs) {
        // No workspace context to enforce (e.g. internal/system calls).
        return;
    }
    const runWs = entry.input?.workspaceId;
    if (!runWs) {
        if (shouldRejectLegacyUntaggedRuns()) {
            throw new AIKernelRequestError("FORBIDDEN_WORKSPACE", "AI run has no workspace tag and legacy-untagged access is disabled.", 403, { runId: entry.run.id, reason: "legacy_untagged" });
        }
        logger_1.logger.warn("[AI Kernel] workspace-untagged run accessed", {
            runId: entry.run.id,
            actorWorkspaceId: actorWs,
        });
        return;
    }
    if (runWs !== actorWs) {
        throw new AIKernelRequestError("FORBIDDEN_WORKSPACE", "AI run belongs to a different workspace.", 403, { runId: entry.run.id });
    }
}
/**
 * Read the env flag each call so tests and operators can toggle it at
 * runtime without restarting the process. Accepts "1", "true", "yes"
 * (case-insensitive) as truthy.
 */
function shouldRejectLegacyUntaggedRuns() {
    const raw = process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}
function filterEntriesByActor(entries, actor) {
    const actorWs = actor?.workspaceId;
    if (!actorWs)
        return entries;
    const rejectUntagged = shouldRejectLegacyUntaggedRuns();
    return entries.filter((entry) => {
        const runWs = entry.input?.workspaceId;
        if (!runWs) {
            // Legacy untagged run: include only if we are still in backward-
            // compatibility mode.
            return !rejectUntagged;
        }
        return runWs === actorWs;
    });
}
function normalizeKernelError(error) {
    if (error instanceof AIKernelRequestError) {
        return {
            code: error.code,
            message: error.message,
            status: error.status,
            ...(error.details !== undefined ? { details: error.details } : {}),
        };
    }
    if (error instanceof server_runs_1.AIUnavailableError) {
        return {
            code: "AI_UNAVAILABLE",
            message: error.message,
            status: 503,
        };
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
        return {
            code: "NOT_FOUND",
            message: error.message,
            status: 404,
        };
    }
    const message = process.env.NODE_ENV === "development" && error instanceof Error && error.message.trim()
        ? error.message
        : "An unexpected AI kernel error occurred.";
    return {
        code: "INTERNAL_SERVER_ERROR",
        message,
        status: 500,
    };
}
