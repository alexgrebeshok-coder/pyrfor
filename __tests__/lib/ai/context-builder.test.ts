import { describe, expect, it, vi } from "vitest";

import {
  buildAIChatContextBundle,
  buildAIChatMessages,
  detectAIChatFocus,
  type AIChatMessage,
} from "@/lib/ai/context-builder";
import type { ExecutiveSnapshot } from "@/lib/briefs/types";
import type { EvidenceListResult } from "@/lib/evidence/types";

describe("AI chat context builder", () => {
  it("detects financial questions and builds a project-scoped prompt", async () => {
    const snapshot = createSnapshot();
    const evidence = createEvidence();

    const bundle = await buildAIChatContextBundle(
      {
        messages: [{ role: "user", content: "Какой бюджет и CPI у проекта?" }],
        projectId: "project-1",
      },
      {
        loadSnapshot: vi.fn().mockResolvedValue(snapshot),
        loadEvidence: vi.fn().mockResolvedValue(evidence),
      }
    );

    expect(detectAIChatFocus("Какой бюджет и CPI у проекта?")).toBe("financial");
    expect(bundle.scope).toBe("project");
    expect(bundle.focus).toBe("financial");
    expect(bundle.projectName).toBe("Склад Южный");
    expect(bundle.systemPrompt).toContain("budgetPlan");
    expect(bundle.systemPrompt).toContain("budgetFact");
    expect(bundle.systemPrompt).toContain("CPI");
    expect(bundle.systemPrompt).toContain("VAC");
    expect(bundle.evidence.summary.total).toBe(2);
    expect(bundle.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Контекст проекта", "Фокус ответа", "План-факт и исполнение", "Evidence"])
    );
  });

  it("prepends the system prompt while preserving existing messages", async () => {
    const bundle = await buildAIChatContextBundle(
      {
        messages: [{ role: "user", content: "Покажи риски" }],
      },
      {
        loadSnapshot: vi.fn().mockResolvedValue(createPortfolioSnapshot()),
        loadEvidence: vi.fn().mockResolvedValue(createEvidence()),
      }
    );

    const messages = buildAIChatMessages(
      [
        { role: "system", content: "Legacy system message" },
        { role: "user", content: "Покажи риски" },
      ],
      bundle
    );

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Ты CEOClaw AI");
    expect(messages[1]).toEqual(
      expect.objectContaining({
        role: "system",
        content: "Legacy system message",
      })
    );
    expect(messages[2]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Покажи риски",
      })
    );
  });
});

function createSnapshot(): ExecutiveSnapshot {
  return {
    generatedAt: "2026-03-22T00:00:00.000Z",
    projects: [
      {
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
          planned: 5200000,
          actual: 6100000,
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
            budgetPlanned: 1800000,
            budgetActual: 2100000,
          },
          {
            date: "2026-03-22T00:00:00.000Z",
            progress: 64,
            budgetPlanned: 3600000,
            budgetActual: 6100000,
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
      {
        id: "task-2",
        projectId: "project-1",
        title: "Утвердить подрядчика",
        status: "done",
        priority: "medium",
        dueDate: "2026-03-18T00:00:00.000Z",
        createdAt: "2026-03-02T00:00:00.000Z",
        completedAt: "2026-03-18T00:00:00.000Z",
        assigneeId: "member-2",
        assigneeName: "Пётр",
      },
      {
        id: "task-3",
        projectId: "project-1",
        title: "Согласовать график",
        status: "in_progress",
        priority: "medium",
        dueDate: "2026-03-24T00:00:00.000Z",
        createdAt: "2026-03-05T00:00:00.000Z",
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
        reportNumber: "#202603220001",
        reportDate: "2026-03-21T00:00:00.000Z",
        status: "approved",
        source: "manual",
        authorId: "author-1",
        reviewerId: "reviewer-1",
        submittedAt: "2026-03-21T00:00:00.000Z",
        reviewedAt: "2026-03-21T00:00:00.000Z",
      },
      {
        id: "wr-2",
        projectId: "project-1",
        reportNumber: "#202603220002",
        reportDate: "2026-03-22T00:00:00.000Z",
        status: "submitted",
        source: "telegram",
        authorId: "author-2",
        reviewerId: null,
        submittedAt: "2026-03-22T00:00:00.000Z",
        reviewedAt: null,
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
      {
        id: "member-2",
        name: "Пётр",
        role: "Engineer",
        capacity: 100,
        allocated: 70,
        projectIds: ["project-1"],
      },
    ],
  };
}

function createPortfolioSnapshot(): ExecutiveSnapshot {
  return {
    generatedAt: "2026-03-22T00:00:00.000Z",
    projects: [],
    tasks: [],
    risks: [],
    milestones: [],
    workReports: [],
    teamMembers: [],
  };
}

function createEvidence(): EvidenceListResult {
  return {
    syncedAt: "2026-03-22T00:00:00.000Z",
    summary: {
      total: 2,
      reported: 1,
      observed: 0,
      verified: 1,
      averageConfidence: 0.7,
      lastObservedAt: "2026-03-21T00:00:00.000Z",
    },
    records: [
      {
        id: "evidence-1",
        sourceType: "work_report:manual",
        sourceRef: "#202603220001",
        entityType: "work_report",
        entityRef: "wr-1",
        projectId: "project-1",
        title: "#202603220001 · approved",
        summary: "Evidence from the approved report.",
        observedAt: "2026-03-21T00:00:00.000Z",
        reportedAt: "2026-03-21T00:00:00.000Z",
        confidence: 0.82,
        verificationStatus: "verified",
        metadata: {
          projectName: "Склад Южный",
        },
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
      {
        id: "evidence-2",
        sourceType: "work_report:telegram",
        sourceRef: "#202603220002",
        entityType: "work_report",
        entityRef: "wr-2",
        projectId: "project-1",
        title: "#202603220002 · submitted",
        summary: "Evidence from the submitted report.",
        observedAt: "2026-03-22T00:00:00.000Z",
        reportedAt: "2026-03-22T00:00:00.000Z",
        confidence: 0.58,
        verificationStatus: "reported",
        metadata: {
          projectName: "Склад Южный",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
      },
    ],
    sync: null,
  };
}
