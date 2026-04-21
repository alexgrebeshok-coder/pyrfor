import { describe, expect, it } from "vitest";
import { SmartAgentSelector, smartSelector } from "@/lib/agents/smart-selector";

describe("SmartAgentSelector", () => {
  const selector = new SmartAgentSelector();

  it("routes research-like tasks to quick-research", () => {
    expect(selector.selectAgent("найди статистику по ВВП")).toBe("quick-research");
    expect(selector.selectAgent("Research the latest Kubernetes operators")).toBe(
      "quick-research"
    );
  });

  it("routes code-like tasks to quick-coder", () => {
    expect(selector.selectAgent("исправь этот баг в функции")).toBe("quick-coder");
    expect(selector.selectAgent("рефактор этой функции")).toBe("quick-coder");
  });

  it("routes writing tasks to writer", () => {
    expect(selector.selectAgent("напиши статью про AI")).toBe("writer");
  });

  it("routes planning tasks to planner", () => {
    expect(selector.selectAgent("составь план и приоритеты на неделю")).toBe("planner");
  });

  it("routes review tasks to main-reviewer", () => {
    // NB: 'отчёт' is owned by the writer bucket and 'код' by the coder
    // bucket by regex ordering; we pick phrases that only trigger the
    // reviewer lane to avoid accidental overlap.
    expect(selector.selectAgent("проведи review и дай оценка")).toBe("main-reviewer");
    expect(selector.selectAgent("check for error in the output")).toBe("main-reviewer");
  });

  it("falls back to main when nothing matches", () => {
    expect(selector.selectAgent("просто поздоровайся")).toBe("main");
  });

  it("getAgentCapabilities returns a known list for each agent", () => {
    expect(selector.getAgentCapabilities("quick-research")).toContain("web-search");
    expect(selector.getAgentCapabilities("quick-coder")).toContain("code-generation");
    // Unknown id falls back to "main"'s capabilities
    expect(selector.getAgentCapabilities("nonexistent")).toEqual(
      expect.arrayContaining(["orchestration", "delegation"])
    );
  });

  it("exposes a singleton", () => {
    expect(smartSelector).toBeInstanceOf(SmartAgentSelector);
  });
});
