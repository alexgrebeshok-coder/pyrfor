import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  buildKernelChatContext: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

vi.mock("@/lib/ai/kernel-context-stack", () => ({
  buildKernelChatContext: mocks.buildKernelChatContext,
}));

import { GET, POST } from "@/app/api/ai/chat/route";

function createAuthContext() {
  return {
    accessProfile: {
      organizationSlug: "ceoclaw-demo",
      userId: "exec-1",
      name: "Executive User",
      role: "EXEC",
      workspaceId: "executive",
    },
    workspace: {
      id: "executive",
    },
  };
}

function createPostRequest(body: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

describe("AI chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
    mocks.buildKernelChatContext.mockResolvedValue(
      createKernelContextResult("Проверь бюджет проекта") as never
    );
  });

  it("responds with the local-model result and injects context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "AI ответ в dev mode.",
              },
            },
          ],
          facts: [
            {
              label: "Evidence ledger",
              value: "2 records · 1 verified · 0 observed · 1 reported",
              meta: "Average confidence: 70%",
            },
          ],
          confidence: {
            score: 78,
            band: "high",
            label: "Высокая",
            rationale: "Grounded in 2 records · 1 verified.",
            basis: ["2 records", "1 verified"],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const response = await POST(
      createPostRequest({
        messages: [{ role: "user", content: "Проверь бюджет проекта" }],
        projectId: "project-1",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      response: string;
      provider: string;
      model: string;
      facts: Array<{ label: string; value: string }>;
      confidence: { score: number; band: string; label: string };
      context: {
        focus: string;
        projectId: string | null;
        projectName: string | null;
        scope: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.response).toBe("AI ответ в dev mode.");
    expect(body.provider).toBe("local");
    expect(body.model).toBe("v11");
    expect(body.facts.length).toBeGreaterThan(0);
    expect(body.confidence).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        band: expect.any(String),
        label: expect.any(String),
      })
    );
    expect(body.context).toEqual(
      expect.objectContaining({
        scope: "project",
        focus: "financial",
        projectId: "project-1",
        projectName: "Склад Южный",
      })
    );
    expect(mocks.authorizeRequest).toHaveBeenCalledTimes(1);
    expect(mocks.buildKernelChatContext).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        messages: [{ role: "user", content: "Проверь бюджет проекта" }],
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      })
    );

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(payload.messages[0]).toEqual(
      expect.objectContaining({
        role: "system",
      })
    );
    expect(payload.messages[0].content).toContain("budgetPlan");
    expect(payload.messages[1]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Проверь бюджет проекта",
      })
    );
  });

  it("accepts the message shortcut payload from the widget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "AI ответ в dev mode.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mocks.buildKernelChatContext.mockResolvedValueOnce(
      createKernelContextResult("Какой риск самый критичный?") as never
    );

    await POST(
      createPostRequest({
        message: "Какой риск самый критичный?",
        projectId: "project-1",
      })
    );

    expect(mocks.buildKernelChatContext).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        messages: [{ role: "user", content: "Какой риск самый критичный?" }],
      })
    );

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[1]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Какой риск самый критичный?",
      })
    );
  });

  it("returns the static GET status payload", async () => {
    const response = await GET(
      new NextRequest(new Request("http://localhost/api/ai/chat", { method: "GET" }))
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      provider: string;
      fallback: string;
    };

    expect(body).toEqual({
      status: "ok",
      provider: "local-first",
      fallback: "zai",
    });
  });
});

function createKernelContextResult(userMessage: string) {
  return {
    bundle: createContextBundle(),
    messages: [
      {
        role: "system",
        content:
          "Ты CEOClaw AI — ассистент для проектных менеджеров.\nbudgetPlan budgetFact CPI SPI EAC VAC",
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    assembly: {
      source: "live",
      scope: "project",
      projectId: "project-1",
      memoryCount: 1,
      issueCount: 0,
      issues: [],
    },
  };
}

function createContextBundle() {
  return {
    source: "live",
    locale: "ru",
    scope: "project",
    focus: "financial",
    generatedAt: "2026-03-22T00:00:00.000Z",
    projectId: "project-1",
    projectName: "Склад Южный",
    projectStatus: "active",
    summary: "Проект «Склад Южный» · budget and execution signals are active.",
    sections: [
      {
        title: "Контекст проекта",
        bullets: ["Проект «Склад Южный» — active."],
      },
    ],
    systemPrompt:
      "Ты CEOClaw AI — ассистент для проектных менеджеров.\nbudgetPlan budgetFact CPI SPI EAC VAC",
    planFact: {
      projectId: "project-1",
      projectName: "Склад Южный",
      referenceDate: "2026-03-22T00:00:00.000Z",
      status: "critical",
      confidence: 0.82,
      currency: "RUB",
      plannedProgress: 76,
      actualProgress: 64,
      reportedProgress: 40,
      taskProgress: 50,
      milestoneProgress: 25,
      progressVariance: -12,
      progressVarianceRatio: -0.158,
      daysToDeadline: 39,
      forecastFinishDate: null,
      budgetVariance: 900000,
      budgetVarianceRatio: 0.173,
      evidence: {
        totalTasks: 3,
        completedTasks: 1,
        blockedTasks: 1,
        overdueTasks: 1,
        totalMilestones: 1,
        completedMilestones: 0,
        overdueMilestones: 0,
        totalWorkReports: 2,
        approvedWorkReports: 1,
        pendingWorkReports: 1,
        rejectedWorkReports: 0,
        lastApprovedWorkReportDate: "2026-03-21T00:00:00.000Z",
        daysSinceLastApprovedReport: 1,
      },
      evm: {
        bac: 5200000,
        pv: 3952000,
        ev: 3328000,
        ac: 6100000,
        cv: -2772000,
        sv: -624000,
        cpi: 0.546,
        spi: 0.843,
        eac: 9520000,
        vac: -4320000,
        percentComplete: 64,
      },
      warnings: [],
    },
    evidence: {
      syncedAt: "2026-03-22T00:00:00.000Z",
      summary: {
        total: 2,
        reported: 1,
        observed: 0,
        verified: 1,
        averageConfidence: 0.7,
        lastObservedAt: "2026-03-21T00:00:00.000Z",
      },
      records: [],
      sync: null,
    },
    alertFeed: {
      generatedAt: "2026-03-22T00:00:00.000Z",
      scope: "project",
      summary: {
        total: 1,
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        averageConfidence: 0.9,
        averageFreshness: 0.8,
      },
      alerts: [
        {
          id: "alert-1",
          scope: "project",
          category: "budget",
          severity: "critical",
          confidence: 0.9,
          freshness: 0.8,
          score: 100,
          projectId: "project-1",
          projectName: "Склад Южный",
          title: "Cost pressure",
          summary: "Budget burn is ahead of plan.",
          whyItMatters: "Budget overruns reduce margin.",
          recommendedAction: "Review the budget baseline.",
          detectedAt: "2026-03-22T00:00:00.000Z",
          metrics: {
            budgetVarianceRatio: 0.173,
          },
        },
      ],
      recommendationsSummary: ["Review the budget baseline."],
    },
  };
}
