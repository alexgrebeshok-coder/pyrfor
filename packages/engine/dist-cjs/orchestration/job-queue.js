"use strict";
// Job Queue Abstraction
// MVP: simple DB-backed queue via AgentWakeupRequest
// Future: swap to BullMQ/Inngest without changing callers
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobQueue = void 0;
const prisma_1 = require("../prisma");
// ── DB-backed implementation ────────────────────────────────
class PrismaJobQueue {
    async enqueue(payload) {
        const triggerData = payload.triggerData
            ? JSON.stringify(payload.triggerData)
            : "{}";
        const existing = await prisma_1.prisma.agentWakeupRequest.findFirst({
            where: payload.idempotencyKey
                ? {
                    agentId: payload.agentId,
                    idempotencyKey: payload.idempotencyKey,
                    status: { in: ["queued", "processing"] },
                }
                : {
                    agentId: payload.agentId,
                    reason: payload.reason,
                    status: "queued",
                },
        });
        if (existing) {
            return this.toJob(existing);
        }
        const row = await prisma_1.prisma.agentWakeupRequest.create({
            data: {
                agentId: payload.agentId,
                reason: payload.reason,
                triggerData,
                idempotencyKey: payload.idempotencyKey,
                maxRetries: payload.maxRetries ?? 3,
            },
        });
        return this.toJob(row);
    }
    async dequeueNext() {
        const row = await prisma_1.prisma.agentWakeupRequest.findFirst({
            where: {
                status: "queued",
                availableAt: { lte: new Date() },
            },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        });
        if (!row)
            return null;
        // Mark as processing (optimistic lock via status check)
        const updated = await prisma_1.prisma.agentWakeupRequest.updateMany({
            where: {
                id: row.id,
                status: "queued",
                availableAt: { lte: new Date() },
            },
            data: { status: "processing" },
        });
        if (updated.count === 0)
            return null; // someone else grabbed it
        return this.toJob({ ...row, status: "processing" });
    }
    async markDone(jobId) {
        await prisma_1.prisma.agentWakeupRequest.update({
            where: { id: jobId },
            data: { status: "processed", processedAt: new Date() },
        });
    }
    async markFailed(jobId) {
        await prisma_1.prisma.agentWakeupRequest.update({
            where: { id: jobId },
            data: { status: "failed", processedAt: new Date() },
        });
    }
    async getPending(agentId) {
        const where = {
            status: { in: ["queued", "processing"] },
        };
        if (agentId)
            where.agentId = agentId;
        const rows = await prisma_1.prisma.agentWakeupRequest.findMany({
            where,
            orderBy: { createdAt: "asc" },
        });
        return rows.map(this.toJob);
    }
    toJob(row) {
        let triggerData = {};
        try {
            triggerData = JSON.parse(row.triggerData);
        }
        catch { }
        return {
            id: row.id,
            agentId: row.agentId,
            reason: row.reason,
            triggerData,
            status: row.status,
            retryCount: row.retryCount,
            maxRetries: row.maxRetries,
            idempotencyKey: row.idempotencyKey,
            createdAt: row.createdAt,
        };
    }
}
// ── Singleton export ────────────────────────────────────────
exports.jobQueue = new PrismaJobQueue();
