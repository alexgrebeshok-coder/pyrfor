import { describe, expect, it } from "vitest";

import { routeToAgentId } from "@/lib/ai/auto-routing";
import type { AIContextSnapshot } from "@/lib/ai/types";

function createContext(overrides: Partial<AIContextSnapshot> = {}): AIContextSnapshot {
  return {
    locale: "ru",
    interfaceLocale: "ru",
    generatedAt: "2026-03-22T00:00:00.000Z",
    activeContext: {
      type: "portfolio",
      pathname: "/chat",
      title: "Portfolio",
      subtitle: "Portfolio overview",
    },
    projects: [],
    tasks: [],
    team: [],
    risks: [],
    notifications: [],
    ...overrides,
  } as AIContextSnapshot;
}

describe("routeToAgentId", () => {
  it("routes explicit director mentions to pmo-director", () => {
    const context = createContext();

    expect(routeToAgentId("@director проверь статус", context)).toBe(
      "pmo-director"
    );
    expect(routeToAgentId("Что думает @pmo?", context)).toBe("pmo-director");
  });

  it("routes risk keywords to risk-researcher", () => {
    const context = createContext();

    expect(routeToAgentId("Есть риск срыва сроков", context)).toBe(
      "risk-researcher"
    );
    expect(routeToAgentId("Critical issue found", context)).toBe(
      "risk-researcher"
    );
  });

  it("routes task requests in an active project to execution-planner", () => {
    const context = createContext({
      activeContext: {
        type: "project",
        pathname: "/projects/chemk",
        title: "CHEMK",
        subtitle: "Active project",
        projectId: "project-1",
      },
      project: {
        status: "active",
      } as never,
    });

    expect(routeToAgentId("Создай задачу в проекте", context)).toBe(
      "execution-planner"
    );
  });

  it("defaults to portfolio-analyst for unrelated text", () => {
    const context = createContext();

    expect(routeToAgentId("Покажи все проекты", context)).toBe(
      "portfolio-analyst"
    );
    expect(routeToAgentId("директива", context)).toBe("portfolio-analyst");
  });
});
