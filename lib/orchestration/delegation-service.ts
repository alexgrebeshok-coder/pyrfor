import { prisma } from "@/lib/prisma";
import type { DelegationStatus } from "./types";

export interface CreateAgentDelegationInput {
  workspaceId: string;
  workflowRunId?: string | null;
  workflowStepId?: string | null;
  parentAgentId?: string | null;
  childAgentId: string;
  parentRunId?: string | null;
  childRunId?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}

export async function createAgentDelegation(input: CreateAgentDelegationInput) {
  return prisma.agentDelegation.create({
    data: {
      workspaceId: input.workspaceId,
      workflowRunId: input.workflowRunId ?? null,
      workflowStepId: input.workflowStepId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      childAgentId: input.childAgentId,
      parentRunId: input.parentRunId ?? null,
      childRunId: input.childRunId ?? null,
      reason: input.reason,
      metadataJson: JSON.stringify(input.metadata ?? {}),
    },
    include: {
      parentAgent: { select: { id: true, name: true, role: true } },
      childAgent: { select: { id: true, name: true, role: true } },
      parentRun: { select: { id: true, status: true, createdAt: true } },
      childRun: { select: { id: true, status: true, createdAt: true } },
    },
  });
}

export async function updateDelegationStatusByChildRun(
  childRunId: string,
  status: DelegationStatus,
  metadataPatch?: Record<string, unknown>
) {
  const existing = await prisma.agentDelegation.findMany({
    where: { childRunId },
    select: {
      id: true,
      metadataJson: true,
    },
  });

  if (existing.length === 0) {
    return { count: 0 };
  }

  await Promise.all(
    existing.map((item) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(item.metadataJson || "{}");
        if (parsed && typeof parsed === "object") {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = {};
      }

      return prisma.agentDelegation.update({
        where: { id: item.id },
        data: {
          status,
          resolvedAt:
            status === "succeeded" || status === "failed" || status === "cancelled"
              ? new Date()
              : null,
          metadataJson: JSON.stringify({
            ...metadata,
            ...(metadataPatch ?? {}),
          }),
        },
      });
    })
  );

  return { count: existing.length };
}

export async function listRunDelegations(runId: string) {
  return prisma.agentDelegation.findMany({
    where: {
      OR: [{ parentRunId: runId }, { childRunId: runId }],
    },
    include: {
      parentAgent: { select: { id: true, name: true, role: true } },
      childAgent: { select: { id: true, name: true, role: true } },
      parentRun: { select: { id: true, status: true, createdAt: true } },
      childRun: { select: { id: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listWorkflowDelegations(workflowRunId: string) {
  return prisma.agentDelegation.findMany({
    where: { workflowRunId },
    include: {
      parentAgent: { select: { id: true, name: true, role: true } },
      childAgent: { select: { id: true, name: true, role: true } },
      parentRun: { select: { id: true, status: true, createdAt: true } },
      childRun: { select: { id: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
