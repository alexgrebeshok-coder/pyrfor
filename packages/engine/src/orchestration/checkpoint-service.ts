import { prisma } from "@/lib/prisma";

import { resolveMaxRetries } from "./retry-policy-service";

export interface CreateHeartbeatCheckpointInput {
  runId: string;
  seq: number;
  stepKey: string;
  checkpointType: string;
  state: Record<string, unknown>;
}

type HeartbeatCheckpointRecord = {
  id: string;
  runId: string;
  seq: number;
  stepKey: string;
  checkpointType: string;
  stateJson: string;
  createdAt: Date;
};

type ReplayableRunRecord = {
  id: string;
  agentId: string;
  workspaceId: string;
  invocationSource: string;
  contextSnapshot: string | null;
  agent: {
    runtimeConfig: string;
  };
  checkpoints: HeartbeatCheckpointRecord[];
};

type CheckpointPrisma = {
  heartbeatRunCheckpoint: {
    create(args: {
      data: {
        runId: string;
        seq: number;
        stepKey: string;
        checkpointType: string;
        stateJson: string;
      };
    }): Promise<HeartbeatCheckpointRecord>;
    findMany(args: {
      where: { runId: string };
      orderBy: { seq: "asc" | "desc" };
    }): Promise<HeartbeatCheckpointRecord[]>;
  };
  heartbeatRun: {
    findUnique(args: {
      where: { id: string };
      include: {
        agent: { select: { runtimeConfig: true } };
        checkpoints: { orderBy: { seq: "asc" | "desc" } };
      };
    }): Promise<ReplayableRunRecord | null>;
    create(args: {
      data: {
        workspaceId: string;
        agentId: string;
        status: string;
        invocationSource: string;
        contextSnapshot: string;
        replayOfRunId: string;
        replayReason: string;
        replayedFromCheckpointId?: string;
      };
    }): Promise<{ id: string }>;
  };
  agentWakeupRequest: {
    create(args: {
      data: {
        agentId: string;
        reason: string;
        triggerData: string;
        status: string;
        idempotencyKey: string;
        maxRetries: number;
      };
    }): Promise<unknown>;
  };
};

function parseObject(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseCheckpointState(checkpoint: Pick<HeartbeatCheckpointRecord, "stateJson">) {
  return parseObject(checkpoint.stateJson);
}

export async function createHeartbeatRunCheckpoint(
  input: CreateHeartbeatCheckpointInput,
  prismaClient: CheckpointPrisma = prisma as unknown as CheckpointPrisma
) {
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

export async function listHeartbeatRunCheckpoints(
  runId: string,
  prismaClient: CheckpointPrisma = prisma as unknown as CheckpointPrisma
) {
  return prismaClient.heartbeatRunCheckpoint.findMany({
    where: { runId },
    orderBy: { seq: "asc" },
  });
}

function resolveReplayTask(
  checkpointState: Record<string, unknown>,
  originalContext: Record<string, unknown>
) {
  if (typeof checkpointState.task === "string" && checkpointState.task.trim()) {
    return checkpointState.task;
  }

  if (typeof originalContext.task === "string" && originalContext.task.trim()) {
    return originalContext.task;
  }

  return undefined;
}

export async function queueHeartbeatRunReplay(
  input: {
    runId: string;
    checkpointId?: string;
    requestedBy?: string;
  },
  prismaClient: CheckpointPrisma = prisma as unknown as CheckpointPrisma
) {
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
      ? (checkpointState.contextSnapshot as Record<string, unknown>)
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
      maxRetries: resolveMaxRetries(run.agent.runtimeConfig),
    },
  });

  return {
    replayRunId: replayRun.id,
    replayOfRunId: run.id,
    replayReason,
    replayedFromCheckpointId: selectedCheckpoint?.id ?? null,
  };
}
