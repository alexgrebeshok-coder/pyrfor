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
export function createAgentDelegation(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        return prisma.agentDelegation.create({
            data: {
                workspaceId: input.workspaceId,
                workflowRunId: (_a = input.workflowRunId) !== null && _a !== void 0 ? _a : null,
                workflowStepId: (_b = input.workflowStepId) !== null && _b !== void 0 ? _b : null,
                parentAgentId: (_c = input.parentAgentId) !== null && _c !== void 0 ? _c : null,
                childAgentId: input.childAgentId,
                parentRunId: (_d = input.parentRunId) !== null && _d !== void 0 ? _d : null,
                childRunId: (_e = input.childRunId) !== null && _e !== void 0 ? _e : null,
                reason: input.reason,
                metadataJson: JSON.stringify((_f = input.metadata) !== null && _f !== void 0 ? _f : {}),
            },
            include: {
                parentAgent: { select: { id: true, name: true, role: true } },
                childAgent: { select: { id: true, name: true, role: true } },
                parentRun: { select: { id: true, status: true, createdAt: true } },
                childRun: { select: { id: true, status: true, createdAt: true } },
            },
        });
    });
}
export function updateDelegationStatusByChildRun(childRunId, status, metadataPatch) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield prisma.agentDelegation.findMany({
            where: { childRunId },
            select: {
                id: true,
                metadataJson: true,
            },
        });
        if (existing.length === 0) {
            return { count: 0 };
        }
        yield Promise.all(existing.map((item) => {
            let metadata = {};
            try {
                const parsed = JSON.parse(item.metadataJson || "{}");
                if (parsed && typeof parsed === "object") {
                    metadata = parsed;
                }
            }
            catch (_a) {
                metadata = {};
            }
            return prisma.agentDelegation.update({
                where: { id: item.id },
                data: {
                    status,
                    resolvedAt: status === "succeeded" || status === "failed" || status === "cancelled"
                        ? new Date()
                        : null,
                    metadataJson: JSON.stringify(Object.assign(Object.assign({}, metadata), (metadataPatch !== null && metadataPatch !== void 0 ? metadataPatch : {}))),
                },
            });
        }));
        return { count: existing.length };
    });
}
export function listRunDelegations(runId) {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
export function listWorkflowDelegations(workflowRunId) {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
