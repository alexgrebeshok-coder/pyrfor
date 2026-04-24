"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentDelegation = createAgentDelegation;
exports.updateDelegationStatusByChildRun = updateDelegationStatusByChildRun;
exports.listRunDelegations = listRunDelegations;
exports.listWorkflowDelegations = listWorkflowDelegations;
const prisma_1 = require("../prisma");
async function createAgentDelegation(input) {
    return prisma_1.prisma.agentDelegation.create({
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
async function updateDelegationStatusByChildRun(childRunId, status, metadataPatch) {
    const existing = await prisma_1.prisma.agentDelegation.findMany({
        where: { childRunId },
        select: {
            id: true,
            metadataJson: true,
        },
    });
    if (existing.length === 0) {
        return { count: 0 };
    }
    await Promise.all(existing.map((item) => {
        let metadata = {};
        try {
            const parsed = JSON.parse(item.metadataJson || "{}");
            if (parsed && typeof parsed === "object") {
                metadata = parsed;
            }
        }
        catch {
            metadata = {};
        }
        return prisma_1.prisma.agentDelegation.update({
            where: { id: item.id },
            data: {
                status,
                resolvedAt: status === "succeeded" || status === "failed" || status === "cancelled"
                    ? new Date()
                    : null,
                metadataJson: JSON.stringify({
                    ...metadata,
                    ...(metadataPatch ?? {}),
                }),
            },
        });
    }));
    return { count: existing.length };
}
async function listRunDelegations(runId) {
    return prisma_1.prisma.agentDelegation.findMany({
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
async function listWorkflowDelegations(workflowRunId) {
    return prisma_1.prisma.agentDelegation.findMany({
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
