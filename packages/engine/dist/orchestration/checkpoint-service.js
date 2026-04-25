var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma.js';
import { resolveMaxRetries } from "./retry-policy-service.js";
function parseObject(value) {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    }
    catch (_a) {
        return {};
    }
}
export function parseCheckpointState(checkpoint) {
    return parseObject(checkpoint.stateJson);
}
export function createHeartbeatRunCheckpoint(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, prismaClient = prisma) {
        return prismaClient.heartbeatRunCheckpoint.create({
            data: {
                runId: input.runId,
                seq: input.seq,
                stepKey: input.stepKey,
                checkpointType: input.checkpointType,
                stateJson: JSON.stringify(input.state),
            },
        });
    });
}
export function listHeartbeatRunCheckpoints(runId_1) {
    return __awaiter(this, arguments, void 0, function* (runId, prismaClient = prisma) {
        return prismaClient.heartbeatRunCheckpoint.findMany({
            where: { runId },
            orderBy: { seq: "asc" },
        });
    });
}
function resolveReplayTask(checkpointState, originalContext) {
    if (typeof checkpointState.task === "string" && checkpointState.task.trim()) {
        return checkpointState.task;
    }
    if (typeof originalContext.task === "string" && originalContext.task.trim()) {
        return originalContext.task;
    }
    return undefined;
}
export function queueHeartbeatRunReplay(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, prismaClient = prisma) {
        var _a, _b, _c, _d, _e;
        const run = yield prismaClient.heartbeatRun.findUnique({
            where: { id: input.runId },
            include: {
                agent: { select: { runtimeConfig: true } },
                checkpoints: { orderBy: { seq: "asc" } },
            },
        });
        if (!run) {
            throw new Error("Run not found");
        }
        const selectedCheckpoint = input.checkpointId
            ? (_a = run.checkpoints.find((checkpoint) => checkpoint.id === input.checkpointId)) !== null && _a !== void 0 ? _a : null
            : (_b = run.checkpoints.at(-1)) !== null && _b !== void 0 ? _b : null;
        if (input.checkpointId && !selectedCheckpoint) {
            throw new Error("Checkpoint not found");
        }
        const originalContext = parseObject(run.contextSnapshot);
        const checkpointState = selectedCheckpoint ? parseCheckpointState(selectedCheckpoint) : {};
        const replayReason = selectedCheckpoint
            ? `checkpoint:${selectedCheckpoint.stepKey}`
            : "manual_replay";
        const task = resolveReplayTask(checkpointState, originalContext);
        const replayContext = Object.assign(Object.assign(Object.assign({}, originalContext), (typeof checkpointState.contextSnapshot === "object" && checkpointState.contextSnapshot
            ? checkpointState.contextSnapshot
            : {})), { task, replayOfRunId: run.id, replayReason, replayedFromCheckpointId: (_c = selectedCheckpoint === null || selectedCheckpoint === void 0 ? void 0 : selectedCheckpoint.id) !== null && _c !== void 0 ? _c : null, replayRequestedBy: (_d = input.requestedBy) !== null && _d !== void 0 ? _d : null });
        const replayRun = yield prismaClient.heartbeatRun.create({
            data: {
                workspaceId: run.workspaceId,
                agentId: run.agentId,
                status: "queued",
                invocationSource: "replay",
                contextSnapshot: JSON.stringify(replayContext),
                replayOfRunId: run.id,
                replayReason,
                replayedFromCheckpointId: selectedCheckpoint === null || selectedCheckpoint === void 0 ? void 0 : selectedCheckpoint.id,
            },
        });
        yield prismaClient.agentWakeupRequest.create({
            data: {
                agentId: run.agentId,
                reason: "event",
                triggerData: JSON.stringify(Object.assign(Object.assign({}, replayContext), { runId: replayRun.id })),
                status: "queued",
                idempotencyKey: `replay:${replayRun.id}`,
                maxRetries: resolveMaxRetries(run.agent.runtimeConfig),
            },
        });
        return {
            replayRunId: replayRun.id,
            replayOfRunId: run.id,
            replayReason,
            replayedFromCheckpointId: (_e = selectedCheckpoint === null || selectedCheckpoint === void 0 ? void 0 : selectedCheckpoint.id) !== null && _e !== void 0 ? _e : null,
        };
    });
}
