import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  requireUser: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
  runAgentExecution: vi.fn(),
  getRouter: vi.fn(() => ({
    getAvailableProviders: () => ["openrouter", "zai", "mock"],
    hasToolCapableProvider: () => false,
  })),
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

vi.mock("@/lib/ai/agent-executor", () => ({
  runAgentExecution: mocks.runAgentExecution,
}));

vi.mock("@/lib/ai/providers", () => ({
  getRouter: mocks.getRouter,
}));

import { POST } from "@/app/api/orchestration/ask-project/route";

describe("ask-project route (Wave F — runAgentExecution)", () => {
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
    mocks.runAgentExecution.mockResolvedValue({
      finalContent: "Проект под риском по срокам.",
      toolCallsMade: 0,
      rounds: 1,
      durationMs: 120,
      aborted: false,
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
    expect(mocks.runAgentExecution).not.toHaveBeenCalled();
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
    expect(mocks.runAgentExecution).not.toHaveBeenCalled();
  });

  it("builds a project-aware prompt and executes via runAgentExecution", async () => {
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
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.answer).toBe("Проект под риском по срокам.");
    expect(body.success).toBe(true);
    expect((body.context as Record<string, number>).taskCount).toBe(2);
    expect((body.context as Record<string, number>).riskCount).toBe(1);

    expect(mocks.runAgentExecution).toHaveBeenCalledTimes(1);

    const [messages, options] = mocks.runAgentExecution.mock.calls[0] ?? [];
    expect(Array.isArray(messages)).toBe(true);
    expect((messages as Array<{ role: string }>)[0].role).toBe("system");
    expect((messages as Array<{ role: string; content: string }>)[0].content).toContain(
      "CPI:"
    );
    expect((messages as Array<{ role: string; content: string }>)[1]).toEqual({
      role: "user",
      content: "Где сейчас главные отклонения?",
    });
    expect(options).toEqual(
      expect.objectContaining({
        agentId: "search-agent",
        workspaceId: "workspace-1",
        enableTools: false,
        provider: "openrouter",
      })
    );
  });

  it("falls back to the next provider on retryable errors", async () => {
    mocks.prisma.project.findUnique.mockResolvedValue({
      name: "Северная развязка",
      status: "active",
      budgetPlan: 1_000_000,
      budgetFact: 800_000,
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-05-01T00:00:00.000Z"),
      progress: 40,
    });
    mocks.runAgentExecution
      .mockRejectedValueOnce(new Error("503 upstream unavailable"))
      .mockRejectedValueOnce(new Error("503 upstream unavailable"))
      .mockResolvedValueOnce({
        finalContent: "recovered after fallback",
        toolCallsMade: 0,
        rounds: 1,
        durationMs: 100,
        aborted: false,
      });

    const response = await POST(
      createRequest({
        projectId: "project-1",
        question: "Что по бюджету?",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.answer).toBe("recovered after fallback");
    expect(body.success).toBe(true);
    // openrouter attempted 2 times, then zai succeeds on first attempt
    expect(mocks.runAgentExecution).toHaveBeenCalledTimes(3);
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
