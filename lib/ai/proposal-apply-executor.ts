import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { buildApplyResult, reduceProposalState } from "@/lib/ai/action-engine";
import { executeAIKernelTool } from "@/lib/ai/kernel-tool-plane";
import { buildApplySafetySummary } from "@/lib/ai/safety";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/server/runtime-mode";
import type {
  AIActionProposal,
  AIApplyExecutionSummary,
  AIApplyExecutionStep,
  AIApplyProposalInput,
  AIApplyResult,
  AIRunRecord,
  AITaskDraft,
} from "@/lib/ai/types";

export async function executeServerAIProposalApply(
  run: AIRunRecord,
  input: AIApplyProposalInput
): Promise<AIRunRecord | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const proposal = run.result?.proposal;
  if (!proposal || proposal.id !== input.proposalId || proposal.type !== "create_tasks") {
    return null;
  }

  const existingDecision = await readApplyDecision(run.id, proposal.id);
  if (existingDecision) {
    return resolveExistingApplyDecision(run, proposal, existingDecision);
  }

  const appliedAt = new Date().toISOString();
  const safety = buildApplySafetySummary(proposal);
  const idempotencyKey = buildProposalIdempotencyKey(run.id, proposal);
  const decision = await createExecutingDecision({
    runId: run.id,
    proposal,
    operatorId: input.operatorId,
    idempotencyKey,
    compensationMode: safety.compensationMode,
    compensationSummary: safety.compensationSummary,
  });

  if (!decision.created) {
    return resolveExistingApplyDecision(run, proposal, decision.record);
  }

  const toolCalls = proposal.tasks.map((task, index) => ({
    toolCallId: buildTaskToolCallId(proposal.id, index),
    task,
  }));

  const results = await Promise.all(
    toolCalls.map(({ toolCallId, task }) =>
      executeAIKernelTool({
        toolName: "create_task",
        toolCallId,
        arguments: buildCreateTaskArguments(task),
      })
    )
  );

  const execution = buildExecutionSummary({
    decisionId: decision.record.id,
    idempotencyKey,
    operatorId: input.operatorId,
    results,
  });

  if (results.some((result) => !result.success)) {
    await prisma.aiApplyDecisionLedger.update({
      where: { id: decision.record.id },
      data: {
        status: "failed",
        toolCallIdsJson: JSON.stringify(execution.toolCallIds),
        resultJson: JSON.stringify(execution),
        errorMessage: buildFailureMessage(results),
        failedAt: new Date(appliedAt),
      },
    });

    throw new Error(buildFailureMessage(results));
  }

  const actionResult = buildExecutedApplyResult({
    proposal,
    appliedAt,
    execution,
  });

  await prisma.aiApplyDecisionLedger.update({
    where: { id: decision.record.id },
    data: {
      status: "executed",
      toolCallIdsJson: JSON.stringify(execution.toolCallIds),
      resultJson: JSON.stringify(actionResult),
      executedAt: new Date(appliedAt),
    },
  });

  return reduceProposalState(
    {
      ...run,
      updatedAt: appliedAt,
    },
    proposal.id,
    "applied",
    actionResult
  );
}

type ApplyDecisionRecord = {
  id: string;
  runId: string;
  proposalId: string;
  proposalType: string;
  idempotencyKey: string;
  status: string;
  operatorId: string | null;
  toolCallIdsJson: string;
  resultJson: string;
  errorMessage: string | null;
  compensationMode: string | null;
  compensationSummary: string | null;
  executedAt: Date | null;
  failedAt: Date | null;
};

async function readApplyDecision(runId: string, proposalId: string) {
  return prisma.aiApplyDecisionLedger.findFirst({
    where: {
      runId,
      proposalId,
    },
  });
}

async function createExecutingDecision(input: {
  runId: string;
  proposal: AIActionProposal;
  operatorId?: string;
  idempotencyKey: string;
  compensationMode: string;
  compensationSummary: string;
}) {
  try {
    const record = await prisma.aiApplyDecisionLedger.create({
      data: {
        id: `ai-apply-${randomUUID()}`,
        runId: input.runId,
        proposalId: input.proposal.id,
        proposalType: input.proposal.type,
        idempotencyKey: input.idempotencyKey,
        status: "executing",
        operatorId: input.operatorId ?? null,
        toolCallIdsJson: JSON.stringify([]),
        resultJson: JSON.stringify({ status: "executing" }),
        errorMessage: null,
        compensationMode: input.compensationMode,
        compensationSummary: input.compensationSummary,
      },
    });

    return {
      created: true as const,
      id: record.id,
      record,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await readApplyDecision(input.runId, input.proposal.id);
      if (existing) {
        return {
          created: false as const,
          id: existing.id,
          record: existing,
        };
      }
    }

    throw error;
  }
}

function resolveExistingApplyDecision(
  run: AIRunRecord,
  proposal: AIActionProposal,
  decision: ApplyDecisionRecord
) {
  if (decision.status === "executing") {
    throw new Error(`Proposal ${proposal.id} apply is already in progress.`);
  }

  if (decision.status === "failed") {
    throw new Error(
      decision.errorMessage ??
        `Proposal ${proposal.id} apply failed and requires operator review before retry.`
    );
  }

  if (decision.status === "executed") {
    if (run.result?.proposal?.state === "applied" && run.result?.actionResult) {
      return run;
    }

    const stored = parseStoredApplyResult(decision.resultJson);
    if (!stored) {
      throw new Error(`Proposal ${proposal.id} apply ledger is missing its result payload.`);
    }

    return reduceProposalState(
      {
        ...run,
        updatedAt: decision.executedAt?.toISOString() ?? new Date().toISOString(),
      },
      proposal.id,
      "applied",
      stored
    );
  }

  throw new Error(`Unsupported apply decision status: ${decision.status}`);
}

function buildProposalIdempotencyKey(runId: string, proposal: AIActionProposal) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        runId,
        proposalId: proposal.id,
        type: proposal.type,
        tasks:
          proposal.type === "create_tasks"
            ? proposal.tasks.map((task) => ({
                projectId: task.projectId,
                title: task.title,
                description: task.description,
                assignee: task.assignee,
                dueDate: task.dueDate,
                priority: task.priority,
                reason: task.reason,
              }))
            : [],
      })
    )
    .digest("hex");
}

function buildTaskToolCallId(proposalId: string, index: number) {
  return `apply-${proposalId}-task-${index}`;
}

function buildCreateTaskArguments(task: AITaskDraft) {
  const description = buildTaskDescription(task);

  return {
    projectId: task.projectId,
    title: task.title,
    description,
    priority: task.priority,
    dueDate: task.dueDate,
  } satisfies Record<string, unknown>;
}

function buildTaskDescription(task: AITaskDraft) {
  const parts = [task.description?.trim(), task.reason?.trim() ? `AI reason: ${task.reason}` : null].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function buildExecutionSummary(input: {
  decisionId: string;
  idempotencyKey: string;
  operatorId?: string;
  results: Array<{
    toolCallId: string;
    name: string;
    success: boolean;
    result: Record<string, unknown>;
    displayMessage: string;
  }>;
}): AIApplyExecutionSummary {
  const steps: AIApplyExecutionStep[] = input.results.map((result) => ({
    toolCallId: result.toolCallId,
    toolName: result.name,
    success: result.success,
    message: result.displayMessage,
    entityId: typeof result.result.taskId === "string" ? result.result.taskId : undefined,
  }));

  return {
    decisionId: input.decisionId,
    status: input.results.every((result) => result.success) ? "executed" : "failed",
    operatorId: input.operatorId ?? null,
    idempotencyKey: input.idempotencyKey,
    toolCallIds: input.results.map((result) => result.toolCallId),
    steps,
  };
}

function buildExecutedApplyResult(input: {
  proposal: AIActionProposal;
  appliedAt: string;
  execution: AIApplyExecutionSummary;
}): AIApplyResult {
  const base = buildApplyResult(input.proposal, input.appliedAt);

  return {
    ...base,
    summary: `Created ${input.execution.steps.length} live task(s) from the approved proposal.`,
    safety: {
      ...base.safety,
      liveMutation: true,
      mutationSurface: "Live task backlog",
    },
    execution: input.execution,
  };
}

function buildFailureMessage(
  results: Array<{
    toolCallId: string;
    success: boolean;
    displayMessage: string;
  }>
) {
  const failures = results.filter((result) => !result.success);
  return failures.length > 0
    ? `Proposal apply failed: ${failures.map((result) => `${result.toolCallId}: ${result.displayMessage}`).join("; ")}`
    : "Proposal apply failed.";
}

function parseStoredApplyResult(value: string): AIApplyResult | null {
  try {
    const parsed = JSON.parse(value) as AIApplyResult;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
