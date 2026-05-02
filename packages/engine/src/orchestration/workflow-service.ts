import { randomUUID } from "crypto";

import { prisma } from '../prisma';
import { broadcastSSE } from '../transport/sse';
import { slugify } from '../utils';

import {
  createAgentDelegation,
  listWorkflowDelegations,
  updateDelegationStatusByChildRun,
} from './delegation-service';
import { jobQueue } from './job-queue';
import { buildWorkflowDag, listReadyWorkflowSteps } from './workflow-dag-bridge';
import type {
  DelegationStatus,
  WorkflowRunStatus,
  WorkflowStepStatus,
  WorkflowTemplateStatus,
} from "./types";

type JsonRecord = Record<string, unknown>;

export interface WorkflowAgentNodeDefinition {
  id: string;
  name: string;
  kind: "agent";
  agentId: string;
  dependsOn?: string[];
  taskTemplate: string;
  maxRetries?: number;
}

export interface WorkflowApprovalNodeDefinition {
  id: string;
  name: string;
  kind: "approval";
  dependsOn?: string[];
  approval: {
    title: string;
    description?: string;
    expiresInHours?: number;
    type?: string;
  };
}

export type WorkflowNodeDefinition =
  | WorkflowAgentNodeDefinition
  | WorkflowApprovalNodeDefinition;

export interface WorkflowTemplateDefinition {
  version?: number;
  outputNodes?: string[];
  nodes: WorkflowNodeDefinition[];
}

export interface CreateWorkflowTemplateInput {
  workspaceId: string;
  name: string;
  slug?: string;
  description?: string | null;
  status?: WorkflowTemplateStatus;
  definition: string | WorkflowTemplateDefinition;
  createdBy?: string | null;
}

export interface UpdateWorkflowTemplateInput {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: WorkflowTemplateStatus;
  definition?: string | WorkflowTemplateDefinition;
}

export interface CreateWorkflowRunInput {
  workspaceId: string;
  templateId: string;
  input?: string | JsonRecord;
  context?: JsonRecord;
  triggerType?: string;
  createdBy?: string | null;
}

function parseObject(raw: string | null | undefined): JsonRecord {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function parseArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function parseWorkflowDefinition(
  definition: string | WorkflowTemplateDefinition
): WorkflowTemplateDefinition {
  const parsed =
    typeof definition === "string"
      ? (JSON.parse(definition) as WorkflowTemplateDefinition)
      : definition;

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) {
    throw new Error("Workflow definition must contain a nodes array");
  }

  const nodeIds = new Set<string>();

  for (const node of parsed.nodes) {
    if (!node || typeof node !== "object") {
      throw new Error("Workflow node must be an object");
    }
    if (!node.id || typeof node.id !== "string") {
      throw new Error("Workflow node id is required");
    }
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate workflow node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!node.name || typeof node.name !== "string") {
      throw new Error(`Workflow node ${node.id} must have a name`);
    }
    const kind = (node as { kind?: string }).kind;
    if (kind !== "agent" && kind !== "approval") {
      throw new Error(`Workflow node ${node.id} has unsupported kind`);
    }

    if (kind === "agent") {
      const agentNode = node as WorkflowAgentNodeDefinition;
      if (!agentNode.agentId || typeof agentNode.agentId !== "string") {
        throw new Error(`Workflow node ${node.id} must reference an agentId`);
      }
      if (!agentNode.taskTemplate || typeof agentNode.taskTemplate !== "string") {
        throw new Error(`Workflow node ${node.id} must define taskTemplate`);
      }
    }

    if (kind === "approval") {
      const approvalNode = node as WorkflowApprovalNodeDefinition;
      if (!approvalNode.approval || typeof approvalNode.approval !== "object") {
        throw new Error(`Workflow node ${node.id} must define approval config`);
      }
      if (
        !approvalNode.approval.title ||
        typeof approvalNode.approval.title !== "string"
      ) {
        throw new Error(`Workflow approval node ${node.id} must define approval.title`);
      }
    }
  }

  for (const node of parsed.nodes) {
    for (const dependencyId of node.dependsOn ?? []) {
      if (!nodeIds.has(dependencyId)) {
        throw new Error(`Workflow node ${node.id} depends on unknown node ${dependencyId}`);
      }
    }
  }

  if (Array.isArray(parsed.outputNodes)) {
    for (const outputId of parsed.outputNodes) {
      if (!nodeIds.has(outputId)) {
        throw new Error(`Workflow output node ${outputId} does not exist`);
      }
    }
  }

  validateWorkflowDag(parsed.nodes);
  return parsed;
}

function validateWorkflowDag(nodes: WorkflowNodeDefinition[]) {
  const remaining = new Set(nodes.map((node) => node.id));
  const completed = new Set<string>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  while (remaining.size > 0) {
    const ready = Array.from(remaining).filter((id) => {
      const node = nodeMap.get(id);
      return (node?.dependsOn ?? []).every((dependencyId) => completed.has(dependencyId));
    });

    if (ready.length === 0) {
      throw new Error("Workflow definition contains circular dependencies");
    }

    for (const id of ready) {
      remaining.delete(id);
      completed.add(id);
    }
  }
}

function stringifyWorkflowDefinition(definition: WorkflowTemplateDefinition) {
  return JSON.stringify(definition);
}

async function ensureWorkflowAgentsExist(workspaceId: string, definition: WorkflowTemplateDefinition) {
  const agentIds = definition.nodes
    .filter((node): node is WorkflowAgentNodeDefinition => node.kind === "agent")
    .map((node) => node.agentId);

  if (agentIds.length === 0) {
    return;
  }

  const existingAgents = await prisma.agent.findMany({
    where: {
      workspaceId,
      id: { in: agentIds },
    },
    select: { id: true },
  });

  const existingIds = new Set(existingAgents.map((agent) => agent.id));
  const missing = agentIds.filter((agentId) => !existingIds.has(agentId));
  if (missing.length > 0) {
    throw new Error(`Workflow references unknown agents: ${missing.join(", ")}`);
  }
}

function normalizeTemplateStatus(value: string | undefined): WorkflowTemplateStatus {
  if (value === "archived" || value === "draft" || value === "active") {
    return value;
  }
  return "active";
}

function parseStepOutputText(outputJson: string | null) {
  const output = parseObject(outputJson);

  if (typeof output.content === "string" && output.content.trim()) {
    return output.content;
  }
  if (typeof output.comment === "string" && output.comment.trim()) {
    return output.comment;
  }
  if (typeof output.summary === "string" && output.summary.trim()) {
    return output.summary;
  }
  if (typeof output.result === "string" && output.result.trim()) {
    return output.result;
  }

  return Object.keys(output).length > 0 ? JSON.stringify(output) : "";
}

function resolveWorkflowInputText(runInput: JsonRecord) {
  if (typeof runInput.prompt === "string" && runInput.prompt.trim()) {
    return runInput.prompt;
  }
  if (typeof runInput.input === "string" && runInput.input.trim()) {
    return runInput.input;
  }
  if (typeof runInput.task === "string" && runInput.task.trim()) {
    return runInput.task;
  }
  if (typeof runInput.description === "string" && runInput.description.trim()) {
    return runInput.description;
  }
  if (Object.keys(runInput).length > 0) {
    return JSON.stringify(runInput, null, 2);
  }
  return "";
}

function renderTemplate(
  template: string,
  runInput: JsonRecord,
  stepsByNodeId: Map<string, { outputJson: string | null; status: string }>,
  dependencies: string[]
) {
  let rendered = template;
  rendered = rendered.replace(/\{\{input\}\}/g, resolveWorkflowInputText(runInput));

  const dependencyOutput = dependencies
    .map((dependencyId) => {
      const step = stepsByNodeId.get(dependencyId);
      if (!step || step.status !== "succeeded") {
        return "";
      }
      return parseStepOutputText(step.outputJson);
    })
    .filter(Boolean)
    .join("\n\n");
  rendered = rendered.replace(/\{\{prev\}\}/g, dependencyOutput || resolveWorkflowInputText(runInput));

  rendered = rendered.replace(/\{\{([\w-]+)\}\}/g, (_, nodeId: string) => {
    const step = stepsByNodeId.get(nodeId);
    return step ? parseStepOutputText(step.outputJson) : "";
  });

  return rendered;
}

function mapHeartbeatRunStatusToStepStatus(status: string): WorkflowStepStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "timed_out":
    default:
      return "failed";
  }
}

function mapHeartbeatRunStatusToDelegationStatus(status: string): DelegationStatus {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "timed_out":
    default:
      return "failed";
  }
}

function summarizeSteps(
  steps: Array<{ status: string }>
): Record<WorkflowStepStatus, number> {
  return steps.reduce(
    (summary, step) => {
      const status = step.status as WorkflowStepStatus;
      if (status in summary) {
        summary[status] += 1;
      }
      return summary;
    },
    {
      pending: 0,
      queued: 0,
      running: 0,
      waiting_approval: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    } satisfies Record<WorkflowStepStatus, number>
  );
}

function computeOutputNodeIds(definition: WorkflowTemplateDefinition) {
  if (definition.outputNodes && definition.outputNodes.length > 0) {
    return definition.outputNodes;
  }

  const dependencyIds = new Set(
    definition.nodes.flatMap((node) => node.dependsOn ?? [])
  );

  return definition.nodes
    .map((node) => node.id)
    .filter((nodeId) => !dependencyIds.has(nodeId));
}

async function loadWorkflowRunInternal(workflowRunId: string) {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      template: true,
      steps: {
        orderBy: { seq: "asc" },
        include: {
          agent: {
            select: { id: true, name: true, role: true, slug: true },
          },
          heartbeatRun: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              startedAt: true,
              finishedAt: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error("Workflow run not found");
  }

  return run;
}

async function hydrateWorkflowRun(workflowRunId: string) {
  const run = await loadWorkflowRunInternal(workflowRunId);
  const approvalIds = run.steps
    .map((step) => step.approvalId)
    .filter((approvalId): approvalId is string => typeof approvalId === "string");

  const [approvals, delegations] = await Promise.all([
    approvalIds.length > 0
      ? prisma.approval.findMany({
          where: { id: { in: approvalIds } },
          select: {
            id: true,
            title: true,
            status: true,
            comment: true,
            createdAt: true,
            reviewedAt: true,
          },
        })
      : Promise.resolve([]),
    listWorkflowDelegations(workflowRunId),
  ]);

  const approvalMap = new Map(approvals.map((approval) => [approval.id, approval]));

  return {
    ...run,
    inputJson: parseObject(run.inputJson),
    contextJson: parseObject(run.contextJson),
    resultJson: parseObject(run.resultJson),
    template: {
      ...run.template,
      definitionJson: parseWorkflowDefinition(run.template.definitionJson),
    },
    steps: run.steps.map((step) => ({
      ...step,
      dependsOn: parseArray(step.dependsOnJson),
      inputJson: parseObject(step.inputJson),
      outputJson: parseObject(step.outputJson),
      approval: step.approvalId ? approvalMap.get(step.approvalId) ?? null : null,
    })),
    delegations: delegations.map((delegation) => ({
      ...delegation,
      metadataJson: parseObject(delegation.metadataJson),
    })),
    summary: summarizeSteps(run.steps),
  };
}

async function queueAgentStep(
  run: Awaited<ReturnType<typeof loadWorkflowRunInternal>>,
  step: Awaited<ReturnType<typeof loadWorkflowRunInternal>>["steps"][number],
  node: WorkflowAgentNodeDefinition,
  stepsByNodeId: Map<string, Awaited<ReturnType<typeof loadWorkflowRunInternal>>["steps"][number]>
) {
  const claimed = await prisma.workflowRunStep.updateMany({
    where: { id: step.id, status: "pending" },
    data: {
      status: "queued",
      startedAt: step.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  const runInput = parseObject(run.inputJson);
  const dependencies = parseArray(step.dependsOnJson);
  const dependentSteps = dependencies
    .map((dependencyId) => stepsByNodeId.get(dependencyId))
    .filter(
      (
        dependency
      ): dependency is Awaited<ReturnType<typeof loadWorkflowRunInternal>>["steps"][number] =>
        Boolean(dependency)
    );
  const renderedTask = renderTemplate(
    node.taskTemplate,
    runInput,
    new Map(
      run.steps.map((candidate) => [
        candidate.nodeId,
        {
          outputJson: candidate.outputJson,
          status: candidate.status,
        },
      ])
    ),
    dependencies
  );

  const attemptNumber = step.attemptCount + 1;
  const parentAgentStep = [...dependentSteps]
    .reverse()
    .find((dependency) => dependency.agentId && dependency.heartbeatRunId);

  const contextSnapshot = {
    workflowRunId: run.id,
    workflowStepId: step.id,
    workflowTemplateId: run.workflowTemplateId,
    workflowNodeId: step.nodeId,
    workflowNodeName: step.name,
    workflowStepType: step.stepType,
    workflowInput: runInput,
    workflowContext: parseObject(run.contextJson),
    dependencyNodeIds: dependentSteps.map((dependency) => dependency.nodeId),
    dependencyRunIds: dependentSteps
      .map((dependency) => dependency.heartbeatRunId)
      .filter((value): value is string => typeof value === "string"),
    parentRunId: parentAgentStep?.heartbeatRunId ?? null,
    delegatedByAgentId: parentAgentStep?.agentId ?? null,
    workflowAttempt: attemptNumber,
    task: renderedTask,
  };

  const childRun = await prisma.heartbeatRun.create({
    data: {
      workspaceId: run.workspaceId,
      agentId: node.agentId,
      status: "queued",
      invocationSource: "workflow",
      contextSnapshot: JSON.stringify(contextSnapshot),
    },
  });

  try {
    await jobQueue.enqueue({
      agentId: node.agentId,
      reason: "event",
      idempotencyKey: `workflow:${run.id}:${step.nodeId}:attempt:${attemptNumber}`,
      maxRetries: node.maxRetries ?? 1,
      triggerData: {
        ...contextSnapshot,
        runId: childRun.id,
      },
    });

    await prisma.workflowRunStep.update({
      where: { id: step.id },
      data: {
        status: "queued",
        heartbeatRunId: childRun.id,
        attemptCount: attemptNumber,
        inputJson: JSON.stringify({
          task: renderedTask,
          dependencyNodeIds: dependentSteps.map((dependency) => dependency.nodeId),
          dependencyRunIds: dependentSteps
            .map((dependency) => dependency.heartbeatRunId)
            .filter((value): value is string => typeof value === "string"),
        }),
      },
    });

    if (parentAgentStep?.agentId && parentAgentStep.heartbeatRunId) {
      await createAgentDelegation({
        workspaceId: run.workspaceId,
        workflowRunId: run.id,
        workflowStepId: step.id,
        parentAgentId: parentAgentStep.agentId,
        childAgentId: node.agentId,
        parentRunId: parentAgentStep.heartbeatRunId,
        childRunId: childRun.id,
        reason: `Workflow "${run.template.name}" delegated "${step.name}"`,
        metadata: {
          nodeId: step.nodeId,
          attemptNumber,
        },
      });
    }

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: "running",
        startedAt: run.startedAt ?? new Date(),
      },
    });

    broadcastSSE("workflow_step_queued", {
      workflowRunId: run.id,
      workflowStepId: step.id,
      heartbeatRunId: childRun.id,
      agentId: node.agentId,
    });
  } catch (error) {
    await prisma.heartbeatRun.update({
      where: { id: childRun.id },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        resultJson: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          errorType: "workflow_queue_error",
        }),
      },
    });

    await prisma.workflowRunStep.update({
      where: { id: step.id },
      data: {
        status: "pending",
        heartbeatRunId: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}

async function createApprovalStep(
  run: Awaited<ReturnType<typeof loadWorkflowRunInternal>>,
  step: Awaited<ReturnType<typeof loadWorkflowRunInternal>>["steps"][number],
  node: WorkflowApprovalNodeDefinition
) {
  const claimed = await prisma.workflowRunStep.updateMany({
    where: { id: step.id, status: "pending" },
    data: {
      status: "waiting_approval",
      startedAt: step.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  const dependencies = parseArray(step.dependsOnJson);
  const stepsByNodeId = new Map(
    run.steps.map((candidate) => [
      candidate.nodeId,
      {
        outputJson: candidate.outputJson,
        status: candidate.status,
      },
    ])
  );
  const runInput = parseObject(run.inputJson);

  const approval = await prisma.approval.create({
    data: {
      id: `apr-wf-${randomUUID()}`,
      type: node.approval.type ?? "workflow_gate",
      entityType: "orchestration_workflow_run",
      entityId: run.id,
      title: renderTemplate(node.approval.title, runInput, stepsByNodeId, dependencies),
      description: node.approval.description
        ? renderTemplate(node.approval.description, runInput, stepsByNodeId, dependencies)
        : null,
      metadata: JSON.stringify({
        canonicalPath: `/settings/agents/workflows/runs/${run.id}`,
        workflowRunId: run.id,
        workflowStepId: step.id,
        workflowNodeId: step.nodeId,
        workflowNodeName: step.name,
      }),
      expiresAt:
        typeof node.approval.expiresInHours === "number"
          ? new Date(Date.now() + node.approval.expiresInHours * 60 * 60 * 1000)
          : null,
    },
  });

  await prisma.workflowRunStep.update({
    where: { id: step.id },
    data: {
      approvalId: approval.id,
      inputJson: JSON.stringify({
        title: approval.title,
        description: approval.description,
      }),
    },
  });

  await prisma.workflowRun.update({
    where: { id: run.id },
    data: {
      status: "waiting_approval",
      startedAt: run.startedAt ?? new Date(),
    },
  });

  broadcastSSE("workflow_step_waiting_approval", {
    workflowRunId: run.id,
    workflowStepId: step.id,
    approvalId: approval.id,
  });
}

async function syncExistingStepState(
  run: Awaited<ReturnType<typeof loadWorkflowRunInternal>>
) {
  const stepRunIds = run.steps
    .map((step) => step.heartbeatRunId)
    .filter((runId): runId is string => typeof runId === "string");
  const approvalIds = run.steps
    .map((step) => step.approvalId)
    .filter((approvalId): approvalId is string => typeof approvalId === "string");

  const [heartbeatRuns, approvals] = await Promise.all([
    stepRunIds.length > 0
      ? prisma.heartbeatRun.findMany({
          where: { id: { in: stepRunIds } },
          include: {
            checkpoints: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        })
      : Promise.resolve([]),
    approvalIds.length > 0
      ? prisma.approval.findMany({
          where: { id: { in: approvalIds } },
        })
      : Promise.resolve([]),
  ]);

  const heartbeatMap = new Map(heartbeatRuns.map((heartbeatRun) => [heartbeatRun.id, heartbeatRun]));
  const approvalMap = new Map(approvals.map((approval) => [approval.id, approval]));

  for (const step of run.steps) {
    if (step.heartbeatRunId) {
      const heartbeatRun = heartbeatMap.get(step.heartbeatRunId);
      if (!heartbeatRun) {
        continue;
      }

      const nextStatus = mapHeartbeatRunStatusToStepStatus(heartbeatRun.status);
      if (nextStatus === "failed" && step.attemptCount < step.maxRetries) {
        await prisma.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "pending",
            heartbeatRunId: null,
            outputJson: JSON.stringify({
              lastFailureRunId: heartbeatRun.id,
              lastFailureStatus: heartbeatRun.status,
            }),
            errorMessage:
              parseObject(heartbeatRun.resultJson).error?.toString() ??
              `Heartbeat run ${heartbeatRun.status}`,
            finishedAt: null,
            checkpointId:
              heartbeatRun.checkpoints[0]?.id ?? step.checkpointId,
          },
        });
        continue;
      }

      await prisma.workflowRunStep.update({
        where: { id: step.id },
        data: {
          status: nextStatus,
          startedAt: heartbeatRun.startedAt ?? step.startedAt,
          finishedAt:
            nextStatus === "queued" || nextStatus === "running"
              ? null
              : heartbeatRun.finishedAt ?? new Date(),
          outputJson:
            nextStatus === "succeeded" ? heartbeatRun.resultJson : step.outputJson,
          errorMessage:
            nextStatus === "failed" || nextStatus === "cancelled"
              ? parseObject(heartbeatRun.resultJson).error?.toString() ??
                `Heartbeat run ${heartbeatRun.status}`
              : null,
          checkpointId: heartbeatRun.checkpoints[0]?.id ?? step.checkpointId,
        },
      });
    }

    if (step.approvalId) {
      const approval = approvalMap.get(step.approvalId);
      if (!approval) {
        continue;
      }

      if (approval.status === "approved") {
        await prisma.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "succeeded",
            outputJson: JSON.stringify({
              approvalId: approval.id,
              comment: approval.comment,
              reviewedAt: approval.reviewedAt?.toISOString() ?? null,
            }),
            errorMessage: null,
            finishedAt: approval.reviewedAt ?? new Date(),
          },
        });
      } else if (approval.status === "rejected") {
        await prisma.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "failed",
            outputJson: JSON.stringify({
              approvalId: approval.id,
              comment: approval.comment,
              reviewedAt: approval.reviewedAt?.toISOString() ?? null,
            }),
            errorMessage: approval.comment ?? `${approval.title} was rejected`,
            finishedAt: approval.reviewedAt ?? new Date(),
          },
        });
      } else {
        await prisma.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "waiting_approval",
          },
        });
      }
    }
  }
}

async function updateWorkflowRunStatus(
  workflowRunId: string,
  definition: WorkflowTemplateDefinition
) {
  const refreshedRun = await loadWorkflowRunInternal(workflowRunId);
  const summary = summarizeSteps(refreshedRun.steps);

  let status: WorkflowRunStatus = refreshedRun.status as WorkflowRunStatus;
  let resultJson = refreshedRun.resultJson;
  let errorMessage = refreshedRun.errorMessage;
  let finishedAt = refreshedRun.finishedAt;
  let startedAt = refreshedRun.startedAt;

  if (summary.failed > 0) {
    status = "failed";
    finishedAt = finishedAt ?? new Date();
    errorMessage =
      refreshedRun.steps.find((step) => step.status === "failed")?.errorMessage ??
      "Workflow failed";
  } else if (summary.cancelled > 0) {
    status = "cancelled";
    finishedAt = finishedAt ?? new Date();
    errorMessage =
      refreshedRun.steps.find((step) => step.status === "cancelled")?.errorMessage ??
      "Workflow cancelled";
  } else if (summary.waiting_approval > 0) {
    status = "waiting_approval";
    startedAt = startedAt ?? new Date();
    finishedAt = null;
    errorMessage = null;
  } else if (summary.pending > 0 || summary.queued > 0 || summary.running > 0) {
    status = "running";
    startedAt = startedAt ?? new Date();
    finishedAt = null;
    errorMessage = null;
  } else {
    const outputNodeIds = computeOutputNodeIds(definition);
    const output = outputNodeIds.map((nodeId) => {
      const step = refreshedRun.steps.find((candidate) => candidate.nodeId === nodeId);
      return {
        nodeId,
        name: step?.name ?? nodeId,
        output: parseObject(step?.outputJson),
      };
    });

    status = "succeeded";
    finishedAt = finishedAt ?? new Date();
    errorMessage = null;
    resultJson = JSON.stringify({
      outputNodes: output,
      summary,
    });
  }

  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status,
      startedAt,
      finishedAt,
      errorMessage,
      resultJson,
    },
  });

  if (status === "succeeded" || status === "failed" || status === "cancelled") {
    broadcastSSE("workflow_run_completed", {
      workflowRunId,
      status,
    });
  }
}

export async function listWorkflowTemplates(
  workspaceId: string,
  status?: WorkflowTemplateStatus
) {
  const templates = await prisma.workflowTemplate.findMany({
    where: {
      workspaceId,
      ...(status ? { status } : {}),
    },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          runs: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return templates.map((template) => ({
    ...template,
    definitionJson: parseWorkflowDefinition(template.definitionJson),
    recentRunStats: summarizeSteps(
      template.runs.map((run) => ({
        status:
          run.status === "waiting_approval"
            ? "waiting_approval"
            : run.status === "succeeded"
              ? "succeeded"
              : run.status === "failed"
                ? "failed"
                : run.status === "cancelled"
                  ? "cancelled"
                  : "running",
      }))
    ),
  }));
}

export async function createWorkflowTemplate(input: CreateWorkflowTemplateInput) {
  const definition = parseWorkflowDefinition(input.definition);
  await ensureWorkflowAgentsExist(input.workspaceId, definition);

  const template = await prisma.workflowTemplate.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      slug: (input.slug?.trim() || slugify(input.name)).slice(0, 60),
      description: input.description ?? null,
      status: normalizeTemplateStatus(input.status),
      definitionJson: stringifyWorkflowDefinition(definition),
      createdBy: input.createdBy ?? null,
    },
  });

  broadcastSSE("workflow_template_created", {
    templateId: template.id,
    workspaceId: input.workspaceId,
  });

  return {
    ...template,
    definitionJson: definition,
  };
}

export async function updateWorkflowTemplate(
  templateId: string,
  input: UpdateWorkflowTemplateInput
) {
  const existing = await prisma.workflowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) {
    throw new Error("Workflow template not found");
  }

  const definition = input.definition
    ? parseWorkflowDefinition(input.definition)
    : parseWorkflowDefinition(existing.definitionJson);

  await ensureWorkflowAgentsExist(existing.workspaceId, definition);

  const definitionChanged =
    stringifyWorkflowDefinition(definition) !== existing.definitionJson;

  const updated = await prisma.workflowTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name ?? existing.name,
      slug: (input.slug?.trim() || existing.slug).slice(0, 60),
      description:
        input.description !== undefined ? input.description : existing.description,
      status:
        input.status !== undefined
          ? normalizeTemplateStatus(input.status)
          : existing.status,
      definitionJson: stringifyWorkflowDefinition(definition),
      version: definitionChanged ? existing.version + 1 : existing.version,
    },
  });

  return {
    ...updated,
    definitionJson: definition,
  };
}

export async function getWorkflowTemplate(templateId: string) {
  const template = await prisma.workflowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error("Workflow template not found");
  }

  return {
    ...template,
    definitionJson: parseWorkflowDefinition(template.definitionJson),
  };
}

export async function createWorkflowRun(input: CreateWorkflowRunInput) {
  const template = await prisma.workflowTemplate.findFirst({
    where: {
      id: input.templateId,
      workspaceId: input.workspaceId,
    },
  });

  if (!template) {
    throw new Error("Workflow template not found");
  }

  const definition = parseWorkflowDefinition(template.definitionJson);
  await ensureWorkflowAgentsExist(input.workspaceId, definition);

  const runInput =
    typeof input.input === "string"
      ? { prompt: input.input }
      : input.input ?? {};

  const workflowRun = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.workflowRun.create({
      data: {
        workflowTemplateId: template.id,
        workspaceId: input.workspaceId,
        status: "queued",
        triggerType: input.triggerType ?? "manual",
        inputJson: JSON.stringify(runInput),
        contextJson: JSON.stringify(input.context ?? {}),
        createdBy: input.createdBy ?? null,
      },
    });

    await tx.workflowRunStep.createMany({
      data: definition.nodes.map((node, index) => ({
        workflowRunId: createdRun.id,
        nodeId: node.id,
        name: node.name,
        stepType: node.kind,
        seq: index,
        agentId: node.kind === "agent" ? node.agentId : null,
        dependsOnJson: JSON.stringify(node.dependsOn ?? []),
        maxRetries: node.kind === "agent" ? node.maxRetries ?? 1 : 1,
      })),
    });

    return createdRun;
  });

  broadcastSSE("workflow_run_created", {
    workflowRunId: workflowRun.id,
    templateId: template.id,
  });

  return advanceWorkflowRun(workflowRun.id);
}

export async function advanceWorkflowRun(workflowRunId: string) {
  const loadedRun = await loadWorkflowRunInternal(workflowRunId);
  const definition = parseWorkflowDefinition(loadedRun.template.definitionJson);
  const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]));

  await syncExistingStepState(loadedRun);

  let refreshedRun = await loadWorkflowRunInternal(workflowRunId);
  const refreshedStepsByNodeId = new Map(
    refreshedRun.steps.map((step) => [step.nodeId, step])
  );

  for (const step of refreshedRun.steps) {
    if (step.status !== "pending") {
      continue;
    }

    const dependencies = parseArray(step.dependsOnJson);
    const dependencySteps = dependencies
      .map((dependencyId) => refreshedStepsByNodeId.get(dependencyId))
      .filter(Boolean);

    const hasFailedDependency = dependencySteps.some(
      (dependency) =>
        dependency &&
        (dependency.status === "failed" || dependency.status === "cancelled")
    );

    if (!hasFailedDependency) {
      continue;
    }

    await prisma.workflowRunStep.update({
      where: { id: step.id },
      data: {
        status: "skipped",
        errorMessage: "Dependency failed",
        finishedAt: new Date(),
      },
    });
  }

  refreshedRun = await loadWorkflowRunInternal(workflowRunId);
  const workflowDag = buildWorkflowDag({
    workflowRunId,
    steps: refreshedRun.steps,
  });
  const readyNodeIds = new Set(
    listReadyWorkflowSteps(workflowDag, refreshedRun.steps).map((step) => step.nodeId)
  );
  const readySteps = refreshedRun.steps.filter(
    (step) => step.status === "pending" && readyNodeIds.has(step.nodeId)
  );

  const stepsByNodeId = new Map(refreshedRun.steps.map((step) => [step.nodeId, step]));

  for (const step of readySteps) {
    const node = nodeMap.get(step.nodeId);
    if (!node) {
      continue;
    }

    if (node.kind === "agent") {
      await queueAgentStep(refreshedRun, step, node, stepsByNodeId);
    } else {
      await createApprovalStep(refreshedRun, step, node);
    }
  }

  await updateWorkflowRunStatus(workflowRunId, definition);
  return hydrateWorkflowRun(workflowRunId);
}

export async function listWorkflowRuns(
  workspaceId: string,
  options: {
    status?: WorkflowRunStatus;
    templateId?: string;
    limit?: number;
  } = {}
) {
  const limit = Math.min(options.limit ?? 20, 100);
  const runs = await prisma.workflowRun.findMany({
    where: {
      workspaceId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.templateId ? { workflowTemplateId: options.templateId } : {}),
    },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          version: true,
          status: true,
        },
      },
      steps: {
        select: {
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return runs.map((run) => ({
    ...run,
    inputJson: parseObject(run.inputJson),
    contextJson: parseObject(run.contextJson),
    resultJson: parseObject(run.resultJson),
    summary: summarizeSteps(run.steps),
  }));
}

export async function getWorkflowRunDetail(workflowRunId: string) {
  return hydrateWorkflowRun(workflowRunId);
}

export async function syncWorkflowStepFromHeartbeatRun(runId: string) {
  const heartbeatRun = await prisma.heartbeatRun.findUnique({
    where: { id: runId },
    include: {
      checkpoints: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!heartbeatRun) {
    return null;
  }

  const contextSnapshot = parseObject(heartbeatRun.contextSnapshot);
  const workflowStepId =
    typeof contextSnapshot.workflowStepId === "string"
      ? contextSnapshot.workflowStepId
      : null;
  const workflowRunId =
    typeof contextSnapshot.workflowRunId === "string"
      ? contextSnapshot.workflowRunId
      : null;

  if (!workflowStepId || !workflowRunId) {
    return null;
  }

  const step = await prisma.workflowRunStep.findUnique({
    where: { id: workflowStepId },
    select: {
      id: true,
      workflowRunId: true,
      maxRetries: true,
      attemptCount: true,
    },
  });

  if (!step || step.workflowRunId !== workflowRunId) {
    return null;
  }

  const mappedStatus = mapHeartbeatRunStatusToStepStatus(heartbeatRun.status);

  if (mappedStatus === "failed" && step.attemptCount < step.maxRetries) {
    await prisma.workflowRunStep.update({
      where: { id: workflowStepId },
      data: {
        status: "pending",
        heartbeatRunId: null,
        checkpointId: heartbeatRun.checkpoints[0]?.id ?? null,
        outputJson: JSON.stringify({
          lastFailureRunId: heartbeatRun.id,
          lastFailureStatus: heartbeatRun.status,
        }),
        errorMessage:
          parseObject(heartbeatRun.resultJson).error?.toString() ??
          `Heartbeat run ${heartbeatRun.status}`,
        finishedAt: null,
      },
    });
  } else {
    await prisma.workflowRunStep.update({
      where: { id: workflowStepId },
      data: {
        status: mappedStatus,
        heartbeatRunId: heartbeatRun.id,
        checkpointId: heartbeatRun.checkpoints[0]?.id ?? null,
        startedAt: heartbeatRun.startedAt ?? undefined,
        finishedAt:
          mappedStatus === "queued" || mappedStatus === "running"
            ? null
            : heartbeatRun.finishedAt ?? new Date(),
        outputJson:
          mappedStatus === "succeeded"
            ? heartbeatRun.resultJson
            : JSON.stringify({
                runId: heartbeatRun.id,
                status: heartbeatRun.status,
              }),
        errorMessage:
          mappedStatus === "failed" || mappedStatus === "cancelled"
            ? parseObject(heartbeatRun.resultJson).error?.toString() ??
              `Heartbeat run ${heartbeatRun.status}`
            : null,
      },
    });
  }

  await updateDelegationStatusByChildRun(
    heartbeatRun.id,
    mapHeartbeatRunStatusToDelegationStatus(heartbeatRun.status),
    {
      workflowRunId,
      workflowStepId,
    }
  );

  return advanceWorkflowRun(workflowRunId);
}
