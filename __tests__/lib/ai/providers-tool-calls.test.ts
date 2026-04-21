/**
 * Native tool-call parity tests for every OpenAI-compatible provider
 * (ZAI, OpenAI, AIJora, Polza, Bothub). Mocks the global `fetch` to
 * return a representative OpenAI chat.completions response with
 * `tool_calls`, and asserts each provider:
 *
 *   - Advertises `supportsToolCalls = true`.
 *   - Normalises the response to `ChatWithToolsResult` (content + toolCalls[]).
 *   - Falls back to the next tool-capable model on 5xx/429/network errors.
 *   - Surfaces a terminal error recognised by `isTransientProviderError`
 *     when all tool-capable models are exhausted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AIJoraProvider,
  BothubProvider,
  isTransientProviderError,
  OpenAIProvider,
  PolzaProvider,
  ZAIProvider,
  type ChatWithToolsOptions,
} from "@/lib/ai/providers";

const TOOLS: ChatWithToolsOptions["tools"] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

function makeToolCallResponse(opts: {
  status?: number;
  body?: string;
}): Response {
  const status = opts.status ?? 200;
  const body =
    opts.body ??
    JSON.stringify({
      choices: [
        {
          message: {
            content: "I'll search for that.",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "search_web",
                  arguments: '{"query":"ceoclaw multi-agent"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ProviderFactory = () => {
  name: string;
  instance: {
    supportsToolCalls?: boolean;
    chatWithTools(messages: { role: "user"; content: string }[], options: ChatWithToolsOptions): Promise<unknown>;
  };
  defaultModel: string;
  apiKeyEnvVar: string;
};

const PROVIDERS: Array<ProviderFactory> = [
  () => ({
    name: "zai",
    instance: new ZAIProvider("test-key"),
    defaultModel: "glm-5",
    apiKeyEnvVar: "ZAI_API_KEY",
  }),
  () => ({
    name: "openai",
    instance: new OpenAIProvider("test-key"),
    defaultModel: "gpt-4o-mini",
    apiKeyEnvVar: "OPENAI_API_KEY",
  }),
  () => ({
    name: "aijora",
    instance: new AIJoraProvider("test-key"),
    defaultModel: "gpt-4o-mini",
    apiKeyEnvVar: "AIJORA_API_KEY",
  }),
  () => ({
    name: "polza",
    instance: new PolzaProvider("test-key"),
    defaultModel: "openai/gpt-4o-mini",
    apiKeyEnvVar: "POLZA_API_KEY",
  }),
  () => ({
    name: "bothub",
    instance: new BothubProvider("test-key"),
    defaultModel: "gpt-4o-mini",
    apiKeyEnvVar: "BOTHUB_API_KEY",
  }),
];

describe("OpenAI-compatible providers — native tool calls", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch" as never);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  for (const make of PROVIDERS) {
    describe(`${make().name}`, () => {
      it("advertises supportsToolCalls", () => {
        const { instance } = make();
        expect(instance.supportsToolCalls).toBe(true);
      });

      it("normalises native tool_calls into ChatWithToolsResult", async () => {
        const { instance } = make();
        fetchSpy.mockResolvedValueOnce(makeToolCallResponse({}) as never);

        const result = (await instance.chatWithTools(
          [{ role: "user", content: "search for ceoclaw" }],
          { tools: TOOLS, toolChoice: "auto" }
        )) as {
          content: string;
          toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
          hasToolCalls: boolean;
          finishReason?: string;
        };

        expect(result.hasToolCalls).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]!.function.name).toBe("search_web");
        expect(result.toolCalls[0]!.function.arguments).toBe(
          '{"query":"ceoclaw multi-agent"}'
        );
        expect(result.finishReason).toBe("tool_calls");
        expect(result.content).toBe("I'll search for that.");
      });

      it("falls back to the next tool-capable model on 5xx", async () => {
        const { instance } = make();
        fetchSpy
          .mockResolvedValueOnce(
            new Response("upstream boom", { status: 503 }) as never
          )
          .mockResolvedValueOnce(makeToolCallResponse({}) as never);

        const result = (await instance.chatWithTools(
          [{ role: "user", content: "search for ceoclaw" }],
          { tools: TOOLS, toolChoice: "auto" }
        )) as { hasToolCalls: boolean };

        expect(result.hasToolCalls).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it("rethrows a transient-recognisable error when all models are exhausted", async () => {
        const { instance } = make();
        // Every response is a 503 → helper will walk through every tool-capable
        // model. We return 503 for all attempts (10 is safely more than any
        // provider's tool-capable model list size).
        for (let i = 0; i < 10; i++) {
          fetchSpy.mockResolvedValueOnce(
            new Response("still failing", { status: 503 }) as never
          );
        }

        let caught: unknown;
        try {
          await instance.chatWithTools(
            [{ role: "user", content: "search for ceoclaw" }],
            { tools: TOOLS, toolChoice: "auto" }
          );
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect(isTransientProviderError(caught)).toBe(true);
      });

      it("rethrows non-retryable 4xx immediately without walking the chain", async () => {
        const { instance } = make();
        fetchSpy.mockResolvedValueOnce(
          new Response("bad request", { status: 400 }) as never
        );

        let caught: unknown;
        try {
          await instance.chatWithTools(
            [{ role: "user", content: "search for ceoclaw" }],
            { tools: TOOLS, toolChoice: "auto" }
          );
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });
  }
});
