var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
import { listWorkflowRuns } from "./workflow-service";
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
    catch (_a) {
        return {};
    }
}
export function getOrchestrationOpsSnapshot(workspaceId_1) {
    return __awaiter(this, arguments, void 0, function* (workspaceId, limit = 8) {
        var _a, _b, _c, _d, _e;
        const now = new Date();
        const [workflowStatusGroups, activeAgentRuns, openDeadLetters, openCircuits, circuitAgents, workflowApprovals, deadLetters, recentWorkflowRuns,] = yield Promise.all([
            prisma.workflowRun.groupBy({
                by: ["status"],
                where: { workspaceId },
                _count: true,
            }),
            prisma.heartbeatRun.count({
                where: {
                    workspaceId,
                    status: { in: ["queued", "running"] },
                },
            }),
            prisma.deadLetterJob.count({
                where: {
                    workspaceId,
                    status: "open",
                },
            }),
            prisma.agentRuntimeState.count({
                where: {
                    agent: { workspaceId },
                    circuitState: { in: ["open", "half-open"] },
                    OR: [
                        { circuitOpenUntil: null },
                        { circuitOpenUntil: { gt: now } },
                    ],
                },
            }),
            prisma.agent.findMany({
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
            prisma.approval.findMany({
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
            prisma.deadLetterJob.findMany({
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
            listWorkflowRuns(workspaceId, { limit }),
        ]);
        const workflowCounts = Object.fromEntries(workflowStatusGroups.map((group) => [group.status, group._count]));
        return {
            summary: {
                activeAgentRuns,
                openDeadLetters,
                openCircuits,
                pendingWorkflowApprovals: workflowApprovals.length,
                activeWorkflowRuns: ((_a = workflowCounts.queued) !== null && _a !== void 0 ? _a : 0) +
                    ((_b = workflowCounts.running) !== null && _b !== void 0 ? _b : 0) +
                    ((_c = workflowCounts.waiting_approval) !== null && _c !== void 0 ? _c : 0),
                failedWorkflowRuns: (_d = workflowCounts.failed) !== null && _d !== void 0 ? _d : 0,
                succeededWorkflowRuns: (_e = workflowCounts.succeeded) !== null && _e !== void 0 ? _e : 0,
            },
            workflowCounts,
            recentWorkflowRuns,
            circuitAgents,
            workflowApprovals: workflowApprovals.map((approval) => (Object.assign(Object.assign({}, approval), { metadata: parseMetadata(approval.metadata) }))),
            deadLetters,
        };
    });
}
