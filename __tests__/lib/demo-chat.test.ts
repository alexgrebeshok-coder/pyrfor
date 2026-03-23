import { describe, expect, it } from "vitest";

import { composeDemoChatResponse } from "@/lib/demo/chat";
import type { AIChatContextBundle } from "@/lib/ai/context-builder";

describe("demo chat response", () => {
  it("surfaces budget facts and a concrete next step for financial questions", () => {
    const response = composeDemoChatResponse(createFinancialBundle());

    expect(response).toContain("Коротко:");
    expect(response).toContain("Факты:");
    expect(response).toContain("Бюджет: plan 1000, fact 1200, variance 200");
    expect(response).toContain("EVM: CPI 0.95, SPI 0.80, EAC 1350, VAC -350");
    expect(response).toContain("Рекомендация:");
    expect(response).toContain("Следующий шаг:");
    expect(response).toContain("Сверьте budgetPlan и budgetFact");
    expect(response).toContain("Откройте проект «Северный коридор»");
  });
});

function createFinancialBundle(): AIChatContextBundle {
  return {
    source: "mock",
    locale: "ru",
    scope: "project",
    focus: "financial",
    generatedAt: "2026-03-23T00:00:00.000Z",
    projectId: "project-1",
    projectName: "Северный коридор",
    projectStatus: "active",
    summary: "Проект «Северный коридор» — active, здоровье 72/100",
    sections: [
      {
        title: "Контекст проекта",
        bullets: [
          "Проект «Северный коридор» — active, здоровье 72/100, прогресс 48.0%.",
          "Срок: 30 мар.; ближайший milestone: Монтаж (24 мар.).",
          "Бюджет: plan 1000, fact 1200, variance 200.",
        ],
      },
      {
        title: "План-факт и исполнение",
        bullets: [
          "План по прогрессу: 50.0%, факт: 48.0%, отклонение: -2.0%.",
          "EVM: CPI 0.95, SPI 0.80, EAC 1350, VAC -350.",
          "Tasks: 4 done, 1 blocked, 2 overdue; work reports: 2 approved, 1 pending, 0 rejected.",
        ],
      },
      {
        title: "Сигналы",
        bullets: [
          "[HIGH] Рост стоимости — budget drift is visible. Action: Reconcile budget now.",
        ],
      },
      {
        title: "Evidence",
        bullets: [
          "Evidence ledger: 3 records, 2 verified, 1 observed, 0 reported, average confidence 0.82.",
        ],
      },
      {
        title: "Команда и ресурсы",
        bullets: [
          "Team size: 5 members, 2 highly loaded.",
        ],
      },
    ],
    planFact: {} as never,
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
      scope: "project",
      summary: {
        total: 1,
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        averageConfidence: 0.82,
        averageFreshness: 0.9,
      },
      alerts: [],
      recommendationsSummary: ["Сверьте budgetPlan и budgetFact", "Откройте проект «Северный коридор»"],
    },
    systemPrompt: "demo",
  };
}
