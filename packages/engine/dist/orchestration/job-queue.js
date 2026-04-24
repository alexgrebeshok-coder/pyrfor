// Job Queue Abstraction
// MVP: simple DB-backed queue via AgentWakeupRequest
// Future: swap to BullMQ/Inngest without changing callers
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
// ── DB-backed implementation ────────────────────────────────
class PrismaJobQueue {
    enqueue(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const triggerData = payload.triggerData
                ? JSON.stringify(payload.triggerData)
                : "{}";
            const existing = yield prisma.agentWakeupRequest.findFirst({
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
            const row = yield prisma.agentWakeupRequest.create({
                data: {
                    agentId: payload.agentId,
                    reason: payload.reason,
                    triggerData,
                    idempotencyKey: payload.idempotencyKey,
                    maxRetries: (_a = payload.maxRetries) !== null && _a !== void 0 ? _a : 3,
                },
            });
            return this.toJob(row);
        });
    }
    dequeueNext() {
        return __awaiter(this, void 0, void 0, function* () {
            const row = yield prisma.agentWakeupRequest.findFirst({
                where: {
                    status: "queued",
                    availableAt: { lte: new Date() },
                },
                orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
            });
            if (!row)
                return null;
            // Mark as processing (optimistic lock via status check)
            const updated = yield prisma.agentWakeupRequest.updateMany({
                where: {
                    id: row.id,
                    status: "queued",
                    availableAt: { lte: new Date() },
                },
                data: { status: "processing" },
            });
            if (updated.count === 0)
                return null; // someone else grabbed it
            return this.toJob(Object.assign(Object.assign({}, row), { status: "processing" }));
        });
    }
    markDone(jobId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield prisma.agentWakeupRequest.update({
                where: { id: jobId },
                data: { status: "processed", processedAt: new Date() },
            });
        });
    }
    markFailed(jobId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield prisma.agentWakeupRequest.update({
                where: { id: jobId },
                data: { status: "failed", processedAt: new Date() },
            });
        });
    }
    getPending(agentId) {
        return __awaiter(this, void 0, void 0, function* () {
            const where = {
                status: { in: ["queued", "processing"] },
            };
            if (agentId)
                where.agentId = agentId;
            const rows = yield prisma.agentWakeupRequest.findMany({
                where,
                orderBy: { createdAt: "asc" },
            });
            return rows.map(this.toJob);
        });
    }
    toJob(row) {
        let triggerData = {};
        try {
            triggerData = JSON.parse(row.triggerData);
        }
        catch (_a) { }
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
export const jobQueue = new PrismaJobQueue();
