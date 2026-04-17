import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
    workflowTemplate: {
      create: vi.fn(),
    },
    workflowRun: {
      findMany: vi.fn(),
    },
  },
  broadcastSSE: vi.fn(),
  jobQueue: {
    enqueue: vi.fn(),
  },
  createAgentDelegation: vi.fn(),
  listWorkflowDelegations: vi.fn(),
  updateDelegationStatusByChildRun: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/sse", () => ({
  broadcastSSE: mocks.broadcastSSE,
}));

vi.mock("@/lib/orchestration/job-queue", () => ({
  jobQueue: mocks.jobQueue,
}));

vi.mock("@/lib/orchestration/delegation-service", () => ({
  createAgentDelegation: mocks.createAgentDelegation,
  listWorkflowDelegations: mocks.listWorkflowDelegations,
  updateDelegationStatusByChildRun: mocks.updateDelegationStatusByChildRun,
}));

import {
  createWorkflowTemplate,
  listWorkflowRuns,
} from "@/lib/orchestration/workflow-service";

describe("workflow service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.agent.findMany.mockResolvedValue([{ id: "agent-1" }]);
    mocks.prisma.workflowTemplate.create.mockResolvedValue({
      id: "template-1",
      workspaceId: "executive",
      name: "Demo workflow",
      slug: "demo-workflow",
      description: "Runs the orchestration graph",
      version: 1,
      status: "active",
      createdBy: "user-1",
      createdAt: new Date("2026-04-16T19:00:00.000Z"),
      updatedAt: new Date("2026-04-16T19:00:00.000Z"),
      definitionJson: "{}",
    });
    mocks.prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        workflowTemplateId: "template-1",
        workspaceId: "executive",
        status: "running",
        triggerType: "manual",
        inputJson: '{"prompt":"Ship workflow"}',
        contextJson: '{"source":"dashboard"}',
        resultJson: null,
        errorMessage: null,
        createdBy: "user-1",
        startedAt: new Date("2026-04-16T19:10:00.000Z"),
        finishedAt: null,
        createdAt: new Date("2026-04-16T19:10:00.000Z"),
        updatedAt: new Date("2026-04-16T19:10:00.000Z"),
        template: {
          id: "template-1",
          name: "Demo workflow",
          version: 1,
          status: "active",
        },
        steps: [
          { status: "running" },
          { status: "waiting_approval" },
          { status: "succeeded" },
        ],
      },
    ]);
  });

  it("rejects circular workflow definitions", async () => {
    await expect(
      createWorkflowTemplate({
        workspaceId: "executive",
        name: "Broken workflow",
        definition: {
          nodes: [
            {
              id: "design",
              name: "Design",
              kind: "agent",
              agentId: "agent-1",
              dependsOn: ["review"],
              taskTemplate: "design {{input}}",
            },
            {
              id: "review",
              name: "Review",
              kind: "agent",
              agentId: "agent-1",
              dependsOn: ["design"],
              taskTemplate: "review {{design}}",
            },
          ],
        },
      })
    ).rejects.toThrow("circular dependencies");
  });

  it("creates templates with validated agent references", async () => {
    const template = await createWorkflowTemplate({
      workspaceId: "executive",
      name: "Demo workflow",
      status: "active",
      createdBy: "user-1",
      definition: {
        outputNodes: ["ship"],
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
    });

    expect(mocks.prisma.agent.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "executive",
        id: { in: ["agent-1"] },
      },
      select: { id: true },
    });
    expect(mocks.prisma.workflowTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "executive",
        name: "Demo workflow",
        status: "active",
        createdBy: "user-1",
        definitionJson: JSON.stringify({
          outputNodes: ["ship"],
          nodes: [
            {
              id: "ship",
              name: "Ship",
              kind: "agent",
              agentId: "agent-1",
              taskTemplate: "ship {{input}}",
            },
          ],
        }),
      }),
    });
    expect(mocks.broadcastSSE).toHaveBeenCalledWith("workflow_template_created", {
      templateId: "template-1",
      workspaceId: "executive",
    });
    expect(template.definitionJson).toEqual({
      outputNodes: ["ship"],
      nodes: [
        {
          id: "ship",
          name: "Ship",
          kind: "agent",
          agentId: "agent-1",
          taskTemplate: "ship {{input}}",
        },
      ],
    });
  });

  it("lists workflow runs with parsed summaries", async () => {
    const runs = await listWorkflowRuns("executive", { limit: 10 });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "run-1",
      status: "running",
      inputJson: { prompt: "Ship workflow" },
      contextJson: { source: "dashboard" },
      summary: {
        running: 1,
        waiting_approval: 1,
        succeeded: 1,
      },
    });
  });
});
