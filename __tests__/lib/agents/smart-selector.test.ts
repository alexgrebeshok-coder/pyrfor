import { describe, expect, it, vi } from "vitest";
import {
  KNOWN_AGENT_IDS,
  SmartAgentSelector,
  smartSelector,
} from "@/lib/agents/smart-selector";
import type { AIRouter } from "@/lib/ai/providers";

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

describe("SmartAgentSelector.parseLlmVerdict", () => {
  const selector = new SmartAgentSelector();

  it("parses strict JSON", () => {
    expect(selector.parseLlmVerdict('{"agentId":"quick-coder"}')).toBe("quick-coder");
  });

  it("tolerates code-fenced JSON", () => {
    expect(
      selector.parseLlmVerdict('```json\n{"agentId":"writer"}\n```')
    ).toBe("writer");
  });

  it("extracts agentId from noisy text via regex", () => {
    expect(
      selector.parseLlmVerdict('ok: "agentId": "planner" (chose planner)')
    ).toBe("planner");
  });

  it("accepts a bare id", () => {
    expect(selector.parseLlmVerdict("main-reviewer")).toBe("main-reviewer");
    expect(selector.parseLlmVerdict("MAIN")).toBe("main");
  });

  it("returns null on garbage input", () => {
    expect(selector.parseLlmVerdict("")).toBeNull();
    expect(selector.parseLlmVerdict("hello world")).toBeNull();
  });
});

describe("SmartAgentSelector.selectAgentAsync", () => {
  function makeRouter(
    chatImpl: (messages: unknown, opts?: unknown) => Promise<string>
  ): AIRouter {
    return {
      getAvailableProviders: () => ["openrouter", "mock"],
      chat: vi.fn(chatImpl),
    } as unknown as AIRouter;
  }

  it("skips the LLM when the heuristic returns a concrete agent", async () => {
    const selector = new SmartAgentSelector();
    const router = makeRouter(async () => '{"agentId":"writer"}');
    const out = await selector.selectAgentAsync("найди статистику", { router });
    expect(out).toBe("quick-research");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("invokes the LLM when the heuristic returns main", async () => {
    const selector = new SmartAgentSelector();
    const router = makeRouter(async () => '{"agentId":"planner"}');
    const out = await selector.selectAgentAsync("just say hi", { router });
    expect(out).toBe("planner");
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("falls back to the heuristic when the LLM returns an unknown id", async () => {
    const selector = new SmartAgentSelector();
    const router = makeRouter(async () => '{"agentId":"nonexistent-agent"}');
    const out = await selector.selectAgentAsync("something vague", { router });
    expect(out).toBe("main");
  });

  it("falls back to the heuristic when the LLM throws", async () => {
    const selector = new SmartAgentSelector();
    const router = makeRouter(async () => {
      throw new Error("provider down");
    });
    const out = await selector.selectAgentAsync("something vague", { router });
    expect(out).toBe("main");
  });

  it("returns main when no providers are available", async () => {
    const selector = new SmartAgentSelector();
    const router = {
      getAvailableProviders: () => [],
      chat: vi.fn(),
    } as unknown as AIRouter;
    const out = await selector.selectAgentAsync("anything", { router });
    expect(out).toBe("main");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("enforces timeout and falls back to heuristic", async () => {
    const selector = new SmartAgentSelector();
    const router = makeRouter(
      () => new Promise((resolve) => setTimeout(() => resolve('{"agentId":"writer"}'), 500))
    );
    const out = await selector.selectAgentAsync("ambiguous task", {
      router,
      timeoutMs: 20,
    });
    expect(out).toBe("main");
  });

  it("exposes the set of known ids", () => {
    expect(KNOWN_AGENT_IDS).toContain("quick-coder");
    expect(KNOWN_AGENT_IDS).toContain("main-reviewer");
  });
});
