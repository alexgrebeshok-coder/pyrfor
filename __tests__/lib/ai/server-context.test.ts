import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleContext: vi.fn(),
  getServerRuntimeState: vi.fn(),
}));

vi.mock("@/lib/ai/context-assembler", () => ({
  assembleContext: mocks.assembleContext,
}));

vi.mock("@/lib/server/runtime-mode", () => ({
  getServerRuntimeState: mocks.getServerRuntimeState,
}));

import { loadServerAIContext, loadServerDashboardState } from "@/lib/ai/server-context";

describe("server context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerRuntimeState.mockReturnValue({
      databaseConfigured: true,
    } as never);
    mocks.assembleContext.mockResolvedValue(createAssemblyResult() as never);
  });

  it("builds an AIContextSnapshot from the assembled executive snapshot", async () => {
    const context = await loadServerAIContext({
      projectId: "project-1",
      locale: "ru",
      pathname: "/projects/project-1",
    });

    expect(context.project?.name).toBe("Склад Южный");
    expect(context.activeContext).toEqual(
      expect.objectContaining({
        type: "project",
        projectId: "project-1",
        pathname: "/projects/project-1",
      })
    );
    expect(context.tasks[0]).toEqual(
      expect.objectContaining({
        id: "task-1",
        status: "blocked",
      })
    );
    expect(context.team[0]?.projects).toContain("Склад Южный");
    expect(mocks.assembleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        includeEvidence: false,
        includeMemory: false,
      })
    );
  });

  it("builds dashboard state from the assembled snapshot", async () => {
    const state = await loadServerDashboardState();

    expect(state.projects[0]).toEqual(
      expect.objectContaining({
        id: "project-1",
        status: "at-risk",
      })
    );
    expect(state.risks[0]).toEqual(
      expect.objectContaining({
        owner: "Анна",
        status: "open",
      })
    );
  });

  it("fails closed when the live runtime is not configured", async () => {
    mocks.getServerRuntimeState.mockReturnValue({
      databaseConfigured: false,
    } as never);

    await expect(loadServerDashboardState()).rejects.toThrow(
      "DATABASE_URL is not configured for live mode."
    );
  });
});

function createAssemblyResult() {
  return {
    source: "live",
    scope: "project",
    generatedAt: "2026-03-25T00:00:00.000Z",
    locale: "ru",
    interfaceLocale: "ru",
    projectId: "project-1",
    project: {
      id: "project-1",
      name: "Склад Южный",
      description: "Строительство склада",
      status: "active",
      priority: "high",
      progress: 64,
      health: 42,
      direction: "construction",
      location: "Сургут",
      budget: {
        planned: 5_200_000,
        actual: 6_100_000,
        currency: "RUB",
      },
      dates: {
        start: "2026-03-01T00:00:00.000Z",
        end: "2026-04-30T00:00:00.000Z",
      },
      nextMilestone: {
        name: "Кровля",
        date: "2026-03-28T00:00:00.000Z",
      },
      history: [
        {
          date: "2026-03-10T00:00:00.000Z",
          progress: 40,
          budgetPlanned: 1_800_000,
          budgetActual: 2_100_000,
        },
      ],
    },
    snapshot: {
      generatedAt: "2026-03-25T00:00:00.000Z",
      projects: [
        {
          id: "project-1",
          name: "Склад Южный",
          description: "Строительство склада",
          status: "at-risk",
          priority: "high",
          progress: 64,
          health: 42,
          direction: "construction",
          location: "Сургут",
          budget: {
            planned: 5_200_000,
            actual: 6_100_000,
            currency: "RUB",
          },
          dates: {
            start: "2026-03-01T00:00:00.000Z",
            end: "2026-04-30T00:00:00.000Z",
          },
          nextMilestone: {
            name: "Кровля",
            date: "2026-03-28T00:00:00.000Z",
          },
          history: [
            {
              date: "2026-03-10T00:00:00.000Z",
              progress: 40,
              budgetPlanned: 1_800_000,
              budgetActual: 2_100_000,
            },
          ],
        },
      ],
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          title: "Проверить смету",
          status: "blocked",
          priority: "high",
          dueDate: "2026-03-20T00:00:00.000Z",
          createdAt: "2026-03-01T00:00:00.000Z",
          completedAt: null,
          assigneeId: "member-1",
          assigneeName: "Иван",
        },
      ],
      risks: [
        {
          id: "risk-1",
          projectId: "project-1",
          title: "Задержка поставок",
          status: "open",
          severity: 5,
          probability: 0.8,
          impact: 0.8,
          mitigation: "Запасной поставщик",
          owner: "Анна",
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
      ],
      milestones: [
        {
          id: "ms-1",
          projectId: "project-1",
          title: "Кровля",
          date: "2026-03-28T00:00:00.000Z",
          status: "upcoming",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
      ],
      workReports: [
        {
          id: "wr-1",
          projectId: "project-1",
          reportNumber: "#202603250001",
          reportDate: "2026-03-24T00:00:00.000Z",
          status: "approved",
          source: "manual",
          authorId: "author-1",
          reviewerId: "reviewer-1",
          submittedAt: "2026-03-24T00:00:00.000Z",
          reviewedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
      teamMembers: [
        {
          id: "member-1",
          name: "Иван",
          role: "PM",
          capacity: 100,
          allocated: 95,
          projectIds: ["project-1"],
        },
      ],
    },
    alertFeed: {
      generatedAt: "2026-03-25T00:00:00.000Z",
      scope: "project",
      summary: {
        total: 1,
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        averageConfidence: 0.8,
        averageFreshness: 0.9,
      },
      alerts: [],
      recommendationsSummary: [],
    },
    planFact: {
      projectId: "project-1",
      projectName: "Склад Южный",
    },
    evidence: null,
    memory: [],
    issues: [],
  };
}
