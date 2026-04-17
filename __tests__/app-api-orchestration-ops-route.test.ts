import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  getOrchestrationOpsSnapshot: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

vi.mock("@/lib/orchestration/ops-service", () => ({
  getOrchestrationOpsSnapshot: mocks.getOrchestrationOpsSnapshot,
}));

import { GET } from "@/app/api/orchestration/ops/route";

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

describe("orchestration ops route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
    mocks.getOrchestrationOpsSnapshot.mockResolvedValue({
      summary: {
        activeAgentRuns: 2,
        openDeadLetters: 1,
        openCircuits: 1,
        pendingWorkflowApprovals: 1,
        activeWorkflowRuns: 3,
        failedWorkflowRuns: 0,
        succeededWorkflowRuns: 4,
      },
      recentWorkflowRuns: [],
      workflowApprovals: [],
      circuitAgents: [],
      deadLetters: [],
    });
  });

  it("returns the orchestration operations snapshot", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/orchestration/ops?workspaceId=executive&limit=6")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        activeAgentRuns: 2,
        openDeadLetters: 1,
        openCircuits: 1,
      },
    });
    expect(mocks.getOrchestrationOpsSnapshot).toHaveBeenCalledWith("executive", 6);
  });
});
