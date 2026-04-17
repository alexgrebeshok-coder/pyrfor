import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  queueHeartbeatRunReplay: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

vi.mock("@/lib/orchestration/checkpoint-service", () => ({
  queueHeartbeatRunReplay: mocks.queueHeartbeatRunReplay,
}));

import { POST } from "@/app/api/orchestration/runs/[runId]/replay/route";

function createAuthContext() {
  return {
    accessProfile: {
      userId: "user-1",
      role: "EXEC",
      workspaceId: "executive",
    },
    workspace: {
      id: "executive",
      label: "Executive",
    },
  };
}

describe("orchestration run replay route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
    mocks.queueHeartbeatRunReplay.mockResolvedValue({
      replayRunId: "run-replay-1",
      replayOfRunId: "run-1",
      replayReason: "checkpoint:run.started",
      replayedFromCheckpointId: "checkpoint-1",
    });
  });

  it("queues a replay for the selected checkpoint", async () => {
    const response = await POST(
      createRequest({ checkpointId: "checkpoint-1" }),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      replayRunId: "run-replay-1",
      replayOfRunId: "run-1",
      replayReason: "checkpoint:run.started",
      replayedFromCheckpointId: "checkpoint-1",
    });
    expect(mocks.queueHeartbeatRunReplay).toHaveBeenCalledWith({
      runId: "run-1",
      checkpointId: "checkpoint-1",
      requestedBy: "user-1",
    });
  });

  it("returns 404 when the source run is missing", async () => {
    mocks.queueHeartbeatRunReplay.mockRejectedValue(new Error("Run not found"));

    const response = await POST(
      createRequest({}),
      { params: Promise.resolve({ runId: "run-missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Run not found",
    });
  });
});

function createRequest(body: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/orchestration/runs/run-1/replay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}
