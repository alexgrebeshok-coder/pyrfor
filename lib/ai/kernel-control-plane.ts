import { randomUUID } from "node:crypto";

import type {
  AIChatContextBundle,
  AIChatContextInput,
  AIChatMessage,
} from "@/lib/ai/context-builder";
import {
  buildKernelChatContext,
  type KernelChatContextResult,
} from "@/lib/ai/kernel-context-stack";
import {
  executeAIKernelTool,
  listAIKernelTools,
  validateAIKernelToolRequest,
  type AIKernelToolDescriptor,
} from "@/lib/ai/kernel-tool-plane";
import {
  AIUnavailableError,
  applyServerAIProposal,
  createServerAIRun,
  getServerAIRun,
  getServerAIRunEntry,
  getServerAIStatus,
  listServerAIRunEntries,
  type ServerAIRunEntry,
  type ServerAIStatus,
} from "@/lib/ai/server-runs";
import { logger } from "@/lib/logger";
import type { AIToolResult } from "@/lib/ai/tools";
import type { AIApplyProposalInput, AIRunInput, AIRunRecord } from "@/lib/ai/types";

export const AI_KERNEL_OPERATIONS = [
  "status",
  "run.create",
  "run.get",
  "run.list",
  "run.apply",
  "chat.context.build",
  "tool.list",
  "tool.execute",
] as const;

export type AIKernelOperation = (typeof AI_KERNEL_OPERATIONS)[number];

export interface AIKernelActorContext {
  userId?: string;
  role?: string;
  workspaceId?: string;
  organizationSlug?: string | null;
}

export interface AIKernelExecutionContext {
  correlationId?: string;
  transport?: "http" | "internal";
  path?: string;
  actor?: AIKernelActorContext;
}

export interface AIKernelRunLookupInput {
  runId: string;
}

export interface AIKernelChatContextBuildInput extends AIChatContextInput {
  includeMessages?: boolean;
}

export interface AIKernelToolExecuteInput {
  toolName: unknown;
  arguments?: unknown;
}

export type AIKernelRequest =
  | {
      operation: "status";
    }
  | {
      operation: "run.create";
      payload: AIRunInput;
    }
  | {
      operation: "run.get";
      payload: AIKernelRunLookupInput;
    }
  | {
      operation: "run.list";
    }
  | {
      operation: "run.apply";
      payload: AIApplyProposalInput;
    }
  | {
      operation: "chat.context.build";
      payload: AIKernelChatContextBuildInput;
    }
  | {
      operation: "tool.list";
    }
  | {
      operation: "tool.execute";
      payload: AIKernelToolExecuteInput;
    };

export type AIKernelOperationDataMap = {
  status: {
    status: ServerAIStatus;
    supportedOperations: readonly AIKernelOperation[];
  };
  "run.create": {
    run: AIRunRecord;
  };
  "run.get": {
    run: AIRunRecord;
  };
  "run.list": {
    runs: AIRunRecord[];
    count: number;
  };
  "run.apply": {
    run: AIRunRecord;
  };
  "chat.context.build": {
    bundle: AIChatContextBundle;
    messages?: AIChatMessage[];
    assembly: KernelChatContextResult["assembly"];
  };
  "tool.list": {
    tools: readonly AIKernelToolDescriptor[];
    count: number;
  };
  "tool.execute": {
    result: AIToolResult;
  };
};

export interface AIKernelError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

export type AIKernelSuccessResponse<Operation extends AIKernelOperation = AIKernelOperation> = {
  success: true;
  operation: Operation;
  correlationId: string;
  timestamp: string;
  data: AIKernelOperationDataMap[Operation];
};

export type AIKernelFailureResponse<Operation extends AIKernelOperation = AIKernelOperation> = {
  success: false;
  operation: Operation;
  correlationId: string;
  timestamp: string;
  error: AIKernelError;
};

export type AIKernelResponse<Operation extends AIKernelOperation = AIKernelOperation> =
  | AIKernelSuccessResponse<Operation>
  | AIKernelFailureResponse<Operation>;

class AIKernelRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AIKernelRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const CHAT_ROLES: ReadonlySet<AIChatMessage["role"]> = new Set(["system", "user", "assistant"]);

export function isAIKernelOperation(value: unknown): value is AIKernelOperation {
  return typeof value === "string" && AI_KERNEL_OPERATIONS.includes(value as AIKernelOperation);
}

export class AIKernelControlPlane {
  async execute<Operation extends AIKernelOperation>(
    request: Extract<AIKernelRequest, { operation: Operation }>,
    context: AIKernelExecutionContext = {}
  ): Promise<AIKernelResponse<Operation>> {
    const correlationId = context.correlationId?.trim() || `kernel-${randomUUID()}`;
    const timestamp = new Date().toISOString();

    try {
      this.validate(request);
      const data = await this.dispatch(request, context);

      return {
        success: true,
        operation: request.operation,
        correlationId,
        timestamp,
        data: data as AIKernelOperationDataMap[Operation],
      };
    } catch (error) {
      const normalizedError = normalizeKernelError(error);

      logger.error("[AI Kernel] request failed", {
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

  private validate(request: AIKernelRequest) {
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
        const exhaustive: never = request;
        throw new AIKernelRequestError(
          "UNSUPPORTED_OPERATION",
          `AI kernel operation is not supported: ${String(exhaustive)}`
        );
      }
    }
  }

  private async dispatch(
    request: AIKernelRequest,
    context: AIKernelExecutionContext = {}
  ): Promise<AIKernelOperationDataMap[AIKernelOperation]> {
    switch (request.operation) {
      case "status":
        return {
          status: getServerAIStatus(),
          supportedOperations: AI_KERNEL_OPERATIONS,
        };
      case "run.create": {
        const stamped = stampActorOntoRunInput(request.payload, context.actor);
        const run = await createServerAIRun(stamped);
        return { run };
      }
      case "run.get": {
        const runId = request.payload.runId.trim();
        const entry = await getServerAIRunEntry(runId);
        assertWorkspaceAccess(entry, context.actor);
        return { run: entry.run };
      }
      case "run.list": {
        const entries = await listServerAIRunEntries();
        const scoped = filterEntriesByActor(entries, context.actor);
        return {
          runs: scoped.map((entry) => entry.run),
          count: scoped.length,
        };
      }
      case "run.apply": {
        const runId = request.payload.runId.trim();
        const entry = await getServerAIRunEntry(runId);
        assertWorkspaceAccess(entry, context.actor);
        const run = await applyServerAIProposal({
          runId,
          proposalId: request.payload.proposalId.trim(),
          operatorId: request.payload.operatorId?.trim() || context.actor?.userId,
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
          result: await executeAIKernelTool(request.payload),
        };
      }
      default: {
        const exhaustive: never = request;
        throw new AIKernelRequestError(
          "UNSUPPORTED_OPERATION",
          `AI kernel operation is not supported: ${String(exhaustive)}`
        );
      }
    }
  }

  private validateRunCreate(input: AIRunInput) {
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

  private validateRunLookup(input: AIKernelRunLookupInput) {
    if (!input?.runId?.trim()) {
      throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
    }
  }

  private validateRunApply(input: AIApplyProposalInput) {
    if (!input?.runId?.trim()) {
      throw new AIKernelRequestError("RUN_ID_REQUIRED", "Run ID is required.");
    }

    if (!input?.proposalId?.trim()) {
      throw new AIKernelRequestError("PROPOSAL_ID_REQUIRED", "Proposal ID is required.");
    }
  }

  private validateChatContextRequest(input: AIKernelChatContextBuildInput) {
    if (!Array.isArray(input?.messages) || input.messages.length === 0) {
      throw new AIKernelRequestError(
        "MESSAGES_REQUIRED",
        "At least one chat message is required."
      );
    }

    const invalidMessage = input.messages.find(
      (message) =>
        !message ||
        !CHAT_ROLES.has(message.role) ||
        typeof message.content !== "string" ||
        !message.content.trim()
    );

    if (invalidMessage) {
      throw new AIKernelRequestError(
        "MESSAGES_INVALID",
        "Chat messages must have a valid role and non-empty content."
      );
    }
  }

  private validateToolExecuteRequest(input: AIKernelToolExecuteInput) {
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
function stampActorOntoRunInput(
  payload: AIRunInput,
  actor: AIKernelActorContext | undefined
): AIRunInput {
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
function assertWorkspaceAccess(
  entry: ServerAIRunEntry,
  actor: AIKernelActorContext | undefined
): void {
  const actorWs = actor?.workspaceId;
  if (!actorWs) {
    // No workspace context to enforce (e.g. internal/system calls).
    return;
  }
  const runWs = entry.input?.workspaceId;
  if (!runWs) {
    if (shouldRejectLegacyUntaggedRuns()) {
      throw new AIKernelRequestError(
        "FORBIDDEN_WORKSPACE",
        "AI run has no workspace tag and legacy-untagged access is disabled.",
        403,
        { runId: entry.run.id, reason: "legacy_untagged" }
      );
    }
    logger.warn("[AI Kernel] workspace-untagged run accessed", {
      runId: entry.run.id,
      actorWorkspaceId: actorWs,
    });
    return;
  }
  if (runWs !== actorWs) {
    throw new AIKernelRequestError(
      "FORBIDDEN_WORKSPACE",
      "AI run belongs to a different workspace.",
      403,
      { runId: entry.run.id }
    );
  }
}

/**
 * Read the env flag each call so tests and operators can toggle it at
 * runtime without restarting the process. Accepts "1", "true", "yes"
 * (case-insensitive) as truthy.
 */
function shouldRejectLegacyUntaggedRuns(): boolean {
  const raw = process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function filterEntriesByActor(
  entries: ServerAIRunEntry[],
  actor: AIKernelActorContext | undefined
): ServerAIRunEntry[] {
  const actorWs = actor?.workspaceId;
  if (!actorWs) return entries;
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

function normalizeKernelError(error: unknown): AIKernelError {
  if (error instanceof AIKernelRequestError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
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

  const message =
    process.env.NODE_ENV === "development" && error instanceof Error && error.message.trim()
      ? error.message
      : "An unexpected AI kernel error occurred.";

  return {
    code: "INTERNAL_SERVER_ERROR",
    message,
    status: 500,
  };
}
