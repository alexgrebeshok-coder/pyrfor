import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDemoChatContext: vi.fn(),
  composeDemoChatResponse: vi.fn(),
}));

vi.mock("@/lib/demo/context", () => ({
  buildDemoChatContext: mocks.buildDemoChatContext,
}));

vi.mock("@/lib/demo/chat", () => ({
  composeDemoChatResponse: mocks.composeDemoChatResponse,
}));

import { POST } from "@/app/api/demo/chat/route";

describe("demo chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDemoChatContext.mockResolvedValue(createContext() as never);
    mocks.composeDemoChatResponse.mockReturnValue("demo response");
  });

  it("responds to the message shortcut payload", async () => {
    const response = await POST(
      createRequest({
        message: "Что с бюджетом?",
      })
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      response: string;
      context: {
        source: string;
        focus: string;
        scope: string;
        alertCount: number;
        evidenceCount: number;
      };
    };

    expect(body).toEqual(
      expect.objectContaining({
        success: true,
        response: "demo response",
        context: expect.objectContaining({
          source: "mock",
          focus: "financial",
          scope: "portfolio",
          alertCount: 2,
          evidenceCount: 3,
        }),
      })
    );

    expect(mocks.buildDemoChatContext).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Что с бюджетом?" }],
      projectId: undefined,
      locale: undefined,
    });
    expect(mocks.composeDemoChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "mock",
      })
    );
  });

  it("passes through a full message array", async () => {
    await POST(
      createRequest({
        locale: "ru",
        messages: [
          { role: "system", content: "ignore" },
          { role: "user", content: "Покажи риск" },
        ],
        projectId: "project-1",
      })
    );

    expect(mocks.buildDemoChatContext).toHaveBeenCalledWith({
      messages: [
        { role: "system", content: "ignore" },
        { role: "user", content: "Покажи риск" },
      ],
      projectId: "project-1",
      locale: "ru",
    });
  });
});

function createRequest(body: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/demo/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

function createContext() {
  return {
    source: "mock",
    locale: "ru",
    scope: "portfolio",
    focus: "financial",
    generatedAt: "2026-03-23T00:00:00.000Z",
    projectId: null,
    projectName: null,
    projectStatus: null,
    summary: "Портфель держится на активных проектах",
    sections: [],
    planFact: {
      totals: {
        projectCount: 4,
        bac: 100,
        pv: 80,
        ev: 70,
        ac: 90,
        cpi: 0.78,
        spi: 0.88,
        eac: 120,
        vac: -20,
        plannedProgress: 42,
        actualProgress: 38,
        progressVariance: -4,
        budgetVariance: 10,
        budgetVarianceRatio: 0.125,
        projectsBehindPlan: 2,
        projectsOverBudget: 1,
        staleFieldReportingProjects: 1,
        pendingReviewProjects: 1,
        criticalProjects: 1,
      },
    },
    evidence: {
      syncedAt: "2026-03-23T00:00:00.000Z",
      summary: {
        total: 3,
        reported: 1,
        observed: 1,
        verified: 1,
        averageConfidence: 0.82,
        lastObservedAt: "2026-03-23T00:00:00.000Z",
      },
      records: [],
      sync: null,
    },
    alertFeed: {
      generatedAt: "2026-03-23T00:00:00.000Z",
      scope: "portfolio",
      summary: {
        total: 2,
        critical: 1,
        high: 1,
        medium: 0,
        low: 0,
        averageConfidence: 0.82,
        averageFreshness: 0.91,
      },
      alerts: [],
      recommendationsSummary: ["Сверьте budgetPlan и budgetFact", "Назначьте owner на главный риск"],
    },
    systemPrompt: "demo",
  };
}
