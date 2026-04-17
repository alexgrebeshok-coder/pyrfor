import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHeartbeatRunCheckpoint,
  parseCheckpointState,
  queueHeartbeatRunReplay,
} from "@/lib/orchestration/checkpoint-service";

function createPrismaMock() {
  return {
    heartbeatRunCheckpoint: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    heartbeatRun: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    agentWakeupRequest: {
      create: vi.fn(),
    },
  };
}

describe("checkpoint service", () => {
  const prisma = createPrismaMock();

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.heartbeatRunCheckpoint.create.mockResolvedValue({ id: "checkpoint-1" });
    prisma.heartbeatRun.findUnique.mockResolvedValue({
      id: "run-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      invocationSource: "cron",
      contextSnapshot: '{"task":"Refresh pipeline status"}',
      agent: {
        runtimeConfig: '{"maxRetries":4}',
      },
      checkpoints: [
        {
          id: "checkpoint-1",
          runId: "run-1",
          seq: 0,
          stepKey: "run.started",
          checkpointType: "run_state",
          stateJson: '{"task":"Refresh pipeline status","contextSnapshot":{"source":"cron"}}',
          createdAt: new Date("2026-04-16T18:00:00.000Z"),
        },
      ],
    });
    prisma.heartbeatRun.create.mockResolvedValue({ id: "run-replay-1" });
    prisma.agentWakeupRequest.create.mockResolvedValue({ id: "wakeup-replay-1" });
  });

  it("persists checkpoints with serialized state", async () => {
    await createHeartbeatRunCheckpoint(
      {
        runId: "run-1",
        seq: 2,
        stepKey: "run.completed",
        checkpointType: "result",
        state: { summary: "done" },
      },
      prisma
    );

    expect(prisma.heartbeatRunCheckpoint.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        seq: 2,
        stepKey: "run.completed",
        checkpointType: "result",
        stateJson: '{"summary":"done"}',
      },
    });
  });

  it("parses checkpoint state JSON safely", () => {
    expect(parseCheckpointState({ stateJson: '{"task":"Demo"}' })).toEqual({
      task: "Demo",
    });
  });

  it("queues replay runs from a checkpoint with preserved task context", async () => {
    const replay = await queueHeartbeatRunReplay(
      {
        runId: "run-1",
        checkpointId: "checkpoint-1",
        requestedBy: "user-1",
      },
      prisma
    );

    expect(replay).toEqual({
      replayRunId: "run-replay-1",
      replayOfRunId: "run-1",
      replayReason: "checkpoint:run.started",
      replayedFromCheckpointId: "checkpoint-1",
    });

    expect(prisma.heartbeatRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        agentId: "agent-1",
        status: "queued",
        invocationSource: "replay",
        replayOfRunId: "run-1",
        replayReason: "checkpoint:run.started",
        replayedFromCheckpointId: "checkpoint-1",
      }),
    });
    expect(prisma.agentWakeupRequest.create).toHaveBeenCalledWith({
      data: {
        agentId: "agent-1",
        reason: "event",
        triggerData: JSON.stringify({
          task: "Refresh pipeline status",
          source: "cron",
          replayOfRunId: "run-1",
          replayReason: "checkpoint:run.started",
          replayedFromCheckpointId: "checkpoint-1",
          replayRequestedBy: "user-1",
          runId: "run-replay-1",
        }),
        status: "queued",
        idempotencyKey: "replay:run-replay-1",
        maxRetries: 4,
      },
    });
  });
});
