import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  requireUser: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
  execute: vi.fn(),
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    risk: {
      findMany: vi.fn(),
    },
    aIRunCost: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/orchestration/actor", () => ({
  resolveActor: mocks.resolveActor,
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/agents/agent-improvements", () => ({
  improvedExecutor: {
    execute: mocks.execute,
  },
}));

import { POST } from "@/app/api/orchestration/ask-project/route";

describe("ask-project route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveActor.mockResolvedValue({
      type: "user",
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    mocks.requireUser.mockReturnValue(undefined);
    mocks.prisma.project.findUnique.mockResolvedValue(null);
    mocks.prisma.task.findMany.mockResolvedValue([]);
    mocks.prisma.risk.findMany.mockResolvedValue([]);
    mocks.prisma.aIRunCost.create.mockResolvedValue({ id: "cost-1" });
    mocks.execute.mockResolvedValue({
      success: true,
      content: "Проект под риском по срокам.",
      tokens: 1200,
      cost: 0.42,
      model: "gpt-5.4",
      provider: "openai",
    });
  });

  it("returns 400 when projectId or question is missing", async () => {
    const response = await POST(
      createRequest({
        question: "Что по срокам?",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "projectId and question required",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns 404 when the project does not exist", async () => {
    const response = await POST(
      createRequest({
        projectId: "project-404",
        question: "Что по срокам?",
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Project not found",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("builds a project-aware prompt, executes the agent, and tracks cost", async () => {
    mocks.prisma.project.findUnique.mockResolvedValue({
      name: "Северная развязка",
      status: "active",
      budgetPlan: 1_000_000,
      budgetFact: 800_000,
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-05-01T00:00:00.000Z"),
      progress: 40,
    });
    mocks.prisma.task.findMany.mockResolvedValue([
      {
        title: "Согласовать бетон",
        status: "in_progress",
        priority: "high",
        dueDate: new Date("2026-04-01T00:00:00.000Z"),
        assignee: { name: "Иван" },
      },
      {
        title: "Подписать КС-2",
        status: "done",
        priority: "medium",
        dueDate: new Date("2026-04-10T00:00:00.000Z"),
        assignee: { name: "Ольга" },
      },
    ]);
    mocks.prisma.risk.findMany.mockResolvedValue([
      {
        title: "Задержка поставки арматуры",
        probability: "high",
        impact: "critical",
        status: "open",
      },
    ]);

    const response = await POST(
      createRequest({
        projectId: "project-1",
        workspaceId: "workspace-1",
        question: "Где сейчас главные отклонения?",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Проект под риском по срокам.",
      success: true,
      tokens: 1200,
      model: "gpt-5.4",
      context: {
        projectName: "Северная развязка",
        taskCount: 2,
        riskCount: 1,
        membersCount: 2,
      },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);

    const [agentId, prompt, metadata, options] = mocks.execute.mock.calls[0] ?? [];
    expect(agentId).toBe("search-agent");
    expect(prompt).toContain("CPI:");
    expect(prompt).toContain("SPI:");
    expect(prompt).toContain('⚠️ Просроченные (1):');
    expect(prompt).toContain('Задержка поставки арматуры [high/critical] — open');
    expect(prompt).toContain("Вопрос пользователя: Где сейчас главные отклонения?");
    expect(metadata).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        metadata: expect.objectContaining({
          feature: "ask-project",
          workspaceId: "workspace-1",
        }),
      })
    );
    expect(options).toEqual(
      expect.objectContaining({
        timeout: 30000,
        saveToMemory: false,
      })
    );

    expect(mocks.prisma.aIRunCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "search-agent",
        workspaceId: "workspace-1",
        projectId: "project-1",
        provider: "openai",
        model: "gpt-5.4",
      }),
    });
  });

  it("logs cost tracking failures without failing the response", async () => {
    mocks.prisma.project.findUnique.mockResolvedValue({
      name: "Северная развязка",
      status: "active",
      budgetPlan: 1_000_000,
      budgetFact: 800_000,
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-05-01T00:00:00.000Z"),
      progress: 40,
    });
    mocks.prisma.aIRunCost.create.mockRejectedValue(new Error("db unavailable"));

    const response = await POST(
      createRequest({
        projectId: "project-1",
        question: "Что по бюджету?",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "ask-project: failed to track cost",
      expect.objectContaining({
        projectId: "project-1",
        error: "db unavailable",
      })
    );
  });
});

function createRequest(body: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/orchestration/ask-project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}
