import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAgentById } from "@/lib/ai/agents";
import { createProviderAdapter } from "@/lib/ai/provider-adapter";
import type { AIRunInput } from "@/lib/ai/types";

type ProviderBehavior =
  | {
      kind: "resolve";
      content: string;
    }
  | {
      kind: "reject";
      message: string;
      status: number;
    };

const mocks = vi.hoisted(() => ({
  providerBehaviors: new Map<string, ProviderBehavior>(),
  openAiConstructor: vi.fn(),
}));

vi.mock("openai", () => {
  const OpenAI = mocks.openAiConstructor.mockImplementation(
    function OpenAIMock(config: { baseURL?: string }) {
      const baseURL = String(config?.baseURL ?? "");

      return {
        chat: {
          completions: {
            create: vi.fn(async () => {
              const behavior = mocks.providerBehaviors.get(baseURL);
              if (!behavior) {
                throw Object.assign(new Error(`No behavior configured for ${baseURL}`), {
                  status: 500,
                });
              }

              if (behavior.kind === "reject") {
                const error = new Error(behavior.message) as Error & {
                  status: number;
                };
                error.status = behavior.status;
                throw error;
              }

              return {
                choices: [
                  {
                    message: {
                      content: behavior.content,
                    },
                  },
                ],
              };
            }),
          },
        },
      };
    }
  );

  return {
    default: OpenAI,
  };
});

let previousOpenRouterApiKey: string | undefined;
let previousProviderPriority: string | undefined;

function createRunInput(prompt = "Проверь проект"): AIRunInput {
  const agent = getAgentById("portfolio-analyst");

  if (!agent) {
    throw new Error("portfolio-analyst agent is missing");
  }

  return {
    agent,
    prompt,
    context: {
      locale: "ru",
      interfaceLocale: "ru",
      generatedAt: "2026-03-22T00:00:00.000Z",
      activeContext: {
        type: "portfolio",
        pathname: "/chat",
        title: "Portfolio overview",
        subtitle: "Current portfolio view",
      },
      projects: [],
      tasks: [],
      team: [],
      risks: [],
      notifications: [],
    },
  };
}

describe("ProviderAdapter", () => {
  beforeEach(() => {
    previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    previousProviderPriority = process.env.AI_PROVIDER_PRIORITY;

    mocks.providerBehaviors.clear();
    mocks.openAiConstructor.mockClear();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();

    if (previousOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
    }

    if (previousProviderPriority === undefined) {
      delete process.env.AI_PROVIDER_PRIORITY;
    } else {
      process.env.AI_PROVIDER_PRIORITY = previousProviderPriority;
    }
  });

  it("falls back to the local model after the first provider fails", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    mocks.providerBehaviors.set("https://openrouter.ai/api/v1", {
      kind: "reject",
      status: 500,
      message: "OpenRouter unavailable",
    });
    mocks.providerBehaviors.set("http://localhost:8000/v1", {
      kind: "resolve",
      content: JSON.stringify({
        summary: "Success from fallback",
        highlights: ["Fallback used"],
        nextSteps: ["Ship it"],
      }),
    });

    const adapter = createProviderAdapter({
      priority: ["openrouter", "local-model"],
    });

    const run = await adapter.runAgent(createRunInput());
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(2500);

    const finalRun = await adapter.getRun(run.id);

    expect(finalRun.status).toBe("done");
    expect(finalRun.result?.summary).toBe("Success from fallback");
    expect(finalRun.result?.highlights).toEqual(["Fallback used"]);
    expect(mocks.openAiConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.openAiConstructor.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        baseURL: "https://openrouter.ai/api/v1",
      })
    );
    expect(mocks.openAiConstructor.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        baseURL: "http://localhost:8000/v1",
      })
    );
  });

  it("marks the run as failed when all providers error", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    mocks.providerBehaviors.set("https://openrouter.ai/api/v1", {
      kind: "reject",
      status: 500,
      message: "OpenRouter unavailable",
    });
    mocks.providerBehaviors.set("http://localhost:8000/v1", {
      kind: "reject",
      status: 500,
      message: "Local model unavailable",
    });

    const adapter = createProviderAdapter({
      priority: ["openrouter", "local-model"],
    });

    const run = await adapter.runAgent(createRunInput("Проверь риски"));
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(2500);

    const finalRun = await adapter.getRun(run.id);

    expect(finalRun.status).toBe("failed");
    expect(finalRun.errorMessage).toContain("openrouter");
    expect(finalRun.errorMessage).toContain("local-model");
  });
});
