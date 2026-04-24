"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCheckpointState = parseCheckpointState;
exports.createHeartbeatRunCheckpoint = createHeartbeatRunCheckpoint;
exports.listHeartbeatRunCheckpoints = listHeartbeatRunCheckpoints;
exports.queueHeartbeatRunReplay = queueHeartbeatRunReplay;
const prisma_1 = require("../prisma");
const retry_policy_service_1 = require("./retry-policy-service");
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
    catch {
        return {};
    }
}
function parseCheckpointState(checkpoint) {
    return parseObject(checkpoint.stateJson);
}
async function createHeartbeatRunCheckpoint(input, prismaClient = prisma_1.prisma) {
    return prismaClient.heartbeatRunCheckpoint.create({
        data: {
            runId: input.runId,
            seq: input.seq,
            stepKey: input.stepKey,
            checkpointType: input.checkpointType,
            stateJson: JSON.stringify(input.state),
        },
    });
}
async function listHeartbeatRunCheckpoints(runId, prismaClient = prisma_1.prisma) {
    return prismaClient.heartbeatRunCheckpoint.findMany({
        where: { runId },
        orderBy: { seq: "asc" },
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
async function queueHeartbeatRunReplay(input, prismaClient = prisma_1.prisma) {
    const run = await prismaClient.heartbeatRun.findUnique({
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
        ? run.checkpoints.find((checkpoint) => checkpoint.id === input.checkpointId) ?? null
        : run.checkpoints.at(-1) ?? null;
    if (input.checkpointId && !selectedCheckpoint) {
        throw new Error("Checkpoint not found");
    }
    const originalContext = parseObject(run.contextSnapshot);
    const checkpointState = selectedCheckpoint ? parseCheckpointState(selectedCheckpoint) : {};
    const replayReason = selectedCheckpoint
        ? `checkpoint:${selectedCheckpoint.stepKey}`
        : "manual_replay";
    const task = resolveReplayTask(checkpointState, originalContext);
    const replayContext = {
        ...originalContext,
        ...(typeof checkpointState.contextSnapshot === "object" && checkpointState.contextSnapshot
            ? checkpointState.contextSnapshot
            : {}),
        task,
        replayOfRunId: run.id,
        replayReason,
        replayedFromCheckpointId: selectedCheckpoint?.id ?? null,
        replayRequestedBy: input.requestedBy ?? null,
    };
    const replayRun = await prismaClient.heartbeatRun.create({
        data: {
            workspaceId: run.workspaceId,
            agentId: run.agentId,
            status: "queued",
            invocationSource: "replay",
            contextSnapshot: JSON.stringify(replayContext),
            replayOfRunId: run.id,
            replayReason,
            replayedFromCheckpointId: selectedCheckpoint?.id,
        },
    });
    await prismaClient.agentWakeupRequest.create({
        data: {
            agentId: run.agentId,
            reason: "event",
            triggerData: JSON.stringify({
                ...replayContext,
                runId: replayRun.id,
            }),
            status: "queued",
            idempotencyKey: `replay:${replayRun.id}`,
            maxRetries: (0, retry_policy_service_1.resolveMaxRetries)(run.agent.runtimeConfig),
        },
    });
    return {
        replayRunId: replayRun.id,
        replayOfRunId: run.id,
        replayReason,
        replayedFromCheckpointId: selectedCheckpoint?.id ?? null,
    };
}
