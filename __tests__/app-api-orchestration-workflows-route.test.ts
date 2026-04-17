import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  listWorkflowTemplates: vi.fn(),
  createWorkflowTemplate: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

vi.mock("@/lib/orchestration/workflow-service", () => ({
  listWorkflowTemplates: mocks.listWorkflowTemplates,
  createWorkflowTemplate: mocks.createWorkflowTemplate,
}));

import {
  GET,
  POST,
} from "@/app/api/orchestration/workflows/route";

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

describe("orchestration workflows route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
    mocks.listWorkflowTemplates.mockResolvedValue([
      { id: "template-1", name: "Demo workflow" },
    ]);
    mocks.createWorkflowTemplate.mockResolvedValue({
      id: "template-1",
      name: "Demo workflow",
      status: "active",
    });
  });

  it("lists workflow templates", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/orchestration/workflows?workspaceId=executive")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templates: [{ id: "template-1", name: "Demo workflow" }],
    });
    expect(mocks.listWorkflowTemplates).toHaveBeenCalledWith("executive", undefined);
  });

  it("creates workflow templates with the current actor as author", async () => {
    const response = await POST(
      new NextRequest(
        new Request("http://localhost/api/orchestration/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: "executive",
            name: "Demo workflow",
            status: "active",
            definition: {
              nodes: [
                {
                  id: "ship",
                  name: "Ship",
                  kind: "agent",
                  agentId: "agent-1",
                  taskTemplate: "ship {{input}}",
                },
              ],
            },
          }),
        })
      )
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      template: {
        id: "template-1",
        name: "Demo workflow",
        status: "active",
      },
    });
    expect(mocks.createWorkflowTemplate).toHaveBeenCalledWith({
      workspaceId: "executive",
      name: "Demo workflow",
      slug: undefined,
      description: undefined,
      status: "active",
      definition: {
        nodes: [
          {
            id: "ship",
            name: "Ship",
            kind: "agent",
            agentId: "agent-1",
            taskTemplate: "ship {{input}}",
          },
        ],
      },
      createdBy: "user-1",
    });
  });
});
