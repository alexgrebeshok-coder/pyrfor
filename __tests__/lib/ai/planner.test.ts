import { describe, expect, it } from "vitest";

import { buildDynamicPlan } from "@/lib/ai/orchestration/planner";
import type { AIRunInput } from "@/lib/ai/types";

interface PlannerTestOverrides {
  prompt?: string;
  agentId?: string;
  context?: AIRunInput["context"];
}

function makeInput(overrides: PlannerTestOverrides = {}): AIRunInput {
  const agentId = overrides.agentId ?? "portfolio-analyst";
  const defaultContext: AIRunInput["context"] = {
    locale: "ru",
    interfaceLocale: "ru",
    generatedAt: new Date().toISOString(),
    activeContext: {
      type: "portfolio",
      pathname: "/",
      title: "",
      subtitle: "",
    },
    projects: [],
    tasks: [],
    team: [],
    risks: [],
    notifications: [],
  };

  return {
    agent: {
      id: agentId,
      kind: "analyst",
      nameKey: "ai.agent.portfolioAnalyst",
      accentClass: "",
      icon: "chart",
      category: "strategic",
    } as unknown as AIRunInput["agent"],
    prompt: overrides.prompt ?? "short",
    context: overrides.context ?? defaultContext,
  };
}

describe("dynamic planner", () => {
  it("returns a known domain rule for portfolio leaders on complex input", () => {
    const plan = buildDynamicPlan(
      makeInput({
        prompt:
          "Составь комплексный анализ портфеля проектов: выдели ключевые риски, приоритеты и план действий на квартал.",
        agentId: "portfolio-analyst",
        context: {
          locale: "ru",
          interfaceLocale: "ru",
          generatedAt: new Date().toISOString(),
          activeContext: {
            type: "portfolio",
            pathname: "/",
            title: "",
            subtitle: "",
          },
          projects: new Array(5).fill({ id: "p" }) as never,
          tasks: [],
          team: [],
          risks: [],
          notifications: [],
        } as never,
      })
    );

    expect(plan.collaborative).toBe(true);
    expect(plan.steps.some((step) => step.agentId === "risk-researcher")).toBe(true);
    expect(plan.steps.some((step) => step.agentId === "status-reporter")).toBe(true);
  });

  it("falls back to a default reviewer for unknown agents on complex prompts", () => {
    const input = makeInput({
      agentId: "custom-unregistered-agent",
      prompt:
        "Stratégique portfolio план на год: риск, бюджет, сроки, план, приоритеты, цели, дедлайн 2026-Q4.",
      context: {
        locale: "ru",
        interfaceLocale: "ru",
        generatedAt: new Date().toISOString(),
        activeContext: {
          type: "portfolio",
          pathname: "/",
          title: "",
          subtitle: "",
        },
        projects: new Array(6).fill({ id: "p" }) as never,
        tasks: new Array(10).fill({ id: "t" }) as never,
        team: [],
        risks: new Array(4).fill({ id: "r" }) as never,
        notifications: [],
      } as never,
    });

    const plan = buildDynamicPlan(input);

    expect(plan.collaborative).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].agentId).toBe("quality-guardian");
    expect(plan.steps[0].role).toBe("reviewer");
  });

  it("stays single-agent for trivial short prompts", () => {
    const plan = buildDynamicPlan(
      makeInput({ agentId: "portfolio-analyst", prompt: "привет" })
    );
    expect(plan.collaborative).toBe(false);
    expect(plan.steps).toHaveLength(0);
  });
});
