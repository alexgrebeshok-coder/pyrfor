var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "node:crypto";
import { buildKernelChatContext, } from './kernel-context-stack.js';
import { executeAIKernelTool, listAIKernelTools, validateAIKernelToolRequest, } from './kernel-tool-plane.js';
import { AIUnavailableError, applyServerAIProposal, createServerAIRun, getServerAIRunEntry, getServerAIStatus, listServerAIRunEntries, } from './server-runs.js';
import { logger } from '../observability/logger.js';
export const AI_KERNEL_OPERATIONS = [
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
export function isAIKernelOperation(value) {
    return typeof value === "string" && AI_KERNEL_OPERATIONS.includes(value);
}
export class AIKernelControlPlane {
    execute(request_1) {
        return __awaiter(this, arguments, void 0, function* (request, context = {}) {
            var _a, _b;
            const correlationId = ((_a = context.correlationId) === null || _a === void 0 ? void 0 : _a.trim()) || `kernel-${randomUUID()}`;
            const timestamp = new Date().toISOString();
            try {
                this.validate(request);
                const data = yield this.dispatch(request, context);
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
                logger.error("[AI Kernel] request failed", {
                    operation: request.operation,
                    correlationId,
                    transport: (_b = context.transport) !== null && _b !== void 0 ? _b : "internal",
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
        });
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
    dispatch(request_1) {
        return __awaiter(this, arguments, void 0, function* (request, context = {}) {
            var _a, _b;
            switch (request.operation) {
                case "status":
                    return {
                        status: getServerAIStatus(),
                        supportedOperations: AI_KERNEL_OPERATIONS,
                    };
                case "run.create": {
                    const stamped = stampActorOntoRunInput(request.payload, context.actor);
                    const run = yield createServerAIRun(stamped);
                    return { run };
                }
                case "run.get": {
                    const runId = request.payload.runId.trim();
                    const entry = yield getServerAIRunEntry(runId);
                    assertWorkspaceAccess(entry, context.actor);
                    return { run: entry.run };
                }
                case "run.list": {
                    const entries = yield listServerAIRunEntries();
                    const scoped = filterEntriesByActor(entries, context.actor);
                    return {
                        runs: scoped.map((entry) => entry.run),
                        count: scoped.length,
                    };
                }
                case "run.apply": {
                    const runId = request.payload.runId.trim();
                    const entry = yield getServerAIRunEntry(runId);
                    assertWorkspaceAccess(entry, context.actor);
                    const run = yield applyServerAIProposal({
                        runId,
                        proposalId: request.payload.proposalId.trim(),
                        operatorId: ((_a = request.payload.operatorId) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = context.actor) === null || _b === void 0 ? void 0 : _b.userId),
                    });
                    return { run };
                }
                case "chat.context.build": {
                    return buildKernelChatContext(request.payload);
                }
                case "tool.list": {
                    const tools = listAIKernelTools();
                    return {
                        tools,
                        count: tools.length,
                    };
                }
                case "tool.execute": {
                    return {
                        result: yield executeAIKernelTool(request.payload),
                    };
                }
                default: {
                    const exhaustive = request;
                    throw new AIKernelRequestError("UNSUPPORTED_OPERATION", `AI kernel operation is not supported: ${String(exhaustive)}`);
                }
            }
        });
    }
    validateRunCreate(input) {
        var _a, _b;
        if (!((_a = input === null || input === void 0 ? void 0 : input.prompt) === null || _a === void 0 ? void 0 : _a.trim())) {
            throw new AIKernelRequestError("PROMPT_REQUIRED", "Prompt is required.");
        }
        if (!((_b = input.agent) === null || _b === void 0 ? void 0 : _b.id)) {
            throw new AIKernelRequestError("AGENT_REQUIRED", "Agent is required.");
        }
        if (!input.context) {
            throw new AIKernelRequestError("CONTEXT_REQUIRED", "Context is required.");
        }
    }
    validateRunLookup(input) {
        var _a;
        if (!((_a = input === null || input === void 0 ? void 0 : input.runId) === null || _a === void 0 ? void 0 : _a.trim())) {
            throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
        }
    }
    validateRunApply(input) {
        var _a, _b;
        if (!((_a = input === null || input === void 0 ? void 0 : input.runId) === null || _a === void 0 ? void 0 : _a.trim())) {
            throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
        }
        if (!((_b = input === null || input === void 0 ? void 0 : input.proposalId) === null || _b === void 0 ? void 0 : _b.trim())) {
            throw new AIKernelRequestError("PROPOSAL_ID_REQUIRED", "Proposal ID is required.");
        }
    }
    validateChatContextRequest(input) {
        if (!Array.isArray(input === null || input === void 0 ? void 0 : input.messages) || input.messages.length === 0) {
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
        const validation = validateAIKernelToolRequest(input);
        if (validation.ok) {
            return;
        }
        switch (validation.code) {
            case "TOOL_NAME_REQUIRED":
            case "INVALID_TOOL_ARGUMENTS":
                throw new AIKernelRequestError(validation.code, validation.message, 400);
            case "UNKNOWN_TOOL":
                throw new AIKernelRequestError(validation.code, validation.message, 400, {
                    supportedTools: listAIKernelTools().map((tool) => tool.name),
                });
        }
    }
}
export const aiKernelControlPlane = new AIKernelControlPlane();
/**
 * Stamp the actor context (workspace + user) onto the run input so downstream
 * persistence carries ownership metadata. The caller may not pass these fields
 * themselves; relying on actor context prevents clients from spoofing.
 */
function stampActorOntoRunInput(payload, actor) {
    const workspaceId = actor === null || actor === void 0 ? void 0 : actor.workspaceId;
    const ownerUserId = actor === null || actor === void 0 ? void 0 : actor.userId;
    if (!workspaceId && !ownerUserId) {
        return payload;
    }
    return Object.assign(Object.assign(Object.assign({}, payload), (workspaceId && !payload.workspaceId ? { workspaceId } : {})), (ownerUserId && !payload.ownerUserId ? { ownerUserId } : {}));
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
    var _a;
    const actorWs = actor === null || actor === void 0 ? void 0 : actor.workspaceId;
    if (!actorWs) {
        // No workspace context to enforce (e.g. internal/system calls).
        return;
    }
    const runWs = (_a = entry.input) === null || _a === void 0 ? void 0 : _a.workspaceId;
    if (!runWs) {
        if (shouldRejectLegacyUntaggedRuns()) {
            throw new AIKernelRequestError("FORBIDDEN_WORKSPACE", "AI run has no workspace tag and legacy-untagged access is disabled.", 403, { runId: entry.run.id, reason: "legacy_untagged" });
        }
        logger.warn("[AI Kernel] workspace-untagged run accessed", {
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
    var _a;
    const raw = (_a = process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}
function filterEntriesByActor(entries, actor) {
    const actorWs = actor === null || actor === void 0 ? void 0 : actor.workspaceId;
    if (!actorWs)
        return entries;
    const rejectUntagged = shouldRejectLegacyUntaggedRuns();
    return entries.filter((entry) => {
        var _a;
        const runWs = (_a = entry.input) === null || _a === void 0 ? void 0 : _a.workspaceId;
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
        return Object.assign({ code: error.code, message: error.message, status: error.status }, (error.details !== undefined ? { details: error.details } : {}));
    }
    if (error instanceof AIUnavailableError) {
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
