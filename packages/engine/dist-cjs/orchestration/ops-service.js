"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrchestrationOpsSnapshot = getOrchestrationOpsSnapshot;
const prisma_1 = require("../prisma");
const workflow_service_1 = require("./workflow-service");
function parseMetadata(raw) {
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
async function getOrchestrationOpsSnapshot(workspaceId, limit = 8) {
    const now = new Date();
    const [workflowStatusGroups, activeAgentRuns, openDeadLetters, openCircuits, circuitAgents, workflowApprovals, deadLetters, recentWorkflowRuns,] = await Promise.all([
        prisma_1.prisma.workflowRun.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: true,
        }),
        prisma_1.prisma.heartbeatRun.count({
            where: {
                workspaceId,
                status: { in: ["queued", "running"] },
            },
        }),
        prisma_1.prisma.deadLetterJob.count({
            where: {
                workspaceId,
                status: "open",
            },
        }),
        prisma_1.prisma.agentRuntimeState.count({
            where: {
                agent: { workspaceId },
                circuitState: { in: ["open", "half-open"] },
                OR: [
                    { circuitOpenUntil: null },
                    { circuitOpenUntil: { gt: now } },
                ],
            },
        }),
        prisma_1.prisma.agent.findMany({
            where: {
                workspaceId,
                runtimeState: {
                    is: {
                        circuitState: { in: ["open", "half-open"] },
                        OR: [
                            { circuitOpenUntil: null },
                            { circuitOpenUntil: { gt: now } },
                        ],
                    },
                },
            },
            select: {
                id: true,
                name: true,
                role: true,
                status: true,
                runtimeState: {
                    select: {
                        circuitState: true,
                        circuitOpenUntil: true,
                        consecutiveFailures: true,
                        lastError: true,
                    },
                },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
        }),
        prisma_1.prisma.approval.findMany({
            where: {
                status: "pending",
                entityType: "orchestration_workflow_run",
            },
            select: {
                id: true,
                title: true,
                createdAt: true,
                entityId: true,
                metadata: true,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        }),
        prisma_1.prisma.deadLetterJob.findMany({
            where: {
                workspaceId,
                status: "open",
            },
            include: {
                agent: {
                    select: {
                        id: true,
                        name: true,
                        role: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        }),
        (0, workflow_service_1.listWorkflowRuns)(workspaceId, { limit }),
    ]);
    const workflowCounts = Object.fromEntries(workflowStatusGroups.map((group) => [group.status, group._count]));
    return {
        summary: {
            activeAgentRuns,
            openDeadLetters,
            openCircuits,
            pendingWorkflowApprovals: workflowApprovals.length,
            activeWorkflowRuns: (workflowCounts.queued ?? 0) +
                (workflowCounts.running ?? 0) +
                (workflowCounts.waiting_approval ?? 0),
            failedWorkflowRuns: workflowCounts.failed ?? 0,
            succeededWorkflowRuns: workflowCounts.succeeded ?? 0,
        },
        workflowCounts,
        recentWorkflowRuns,
        circuitAgents,
        workflowApprovals: workflowApprovals.map((approval) => ({
            ...approval,
            metadata: parseMetadata(approval.metadata),
        })),
        deadLetters,
    };
}
