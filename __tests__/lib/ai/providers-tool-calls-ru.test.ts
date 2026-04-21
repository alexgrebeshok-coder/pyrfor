/**
 * Native tool-call tests for Russian providers (GigaChat, YandexGPT).
 * Unlike the OpenAI-compatible providers, their tool-call payloads and
 * response shapes differ:
 *   - GigaChat: legacy `function_call` with a single `{name, arguments}`
 *     field on the assistant message.
 *   - YandexGPT: `toolCallList.toolCalls[].functionCall` with `arguments`
 *     as an object (not a string).
 *
 * Both implementations must normalise into `ChatWithToolsResult` so the
 * rest of the kernel can treat them uniformly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GigaChatProvider,
  YandexGPTProvider,
  type ChatWithToolsOptions,
} from "@/lib/ai/providers";

const TOOLS: ChatWithToolsOptions["tools"] = [
  {
    type: "function",
    function: {
      name: "lookup_section",
      description: "Fetch section metadata",
      parameters: {
        type: "object",
        properties: { section: { type: "string" } },
        required: ["section"],
      },
    },
  },
];

const OAUTH_TOKEN_BODY = JSON.stringify({ access_token: "giga-test-token" });

function gigachatResponse(opts?: {
  status?: number;
  fnArgs?: unknown;
  noFunctionCall?: boolean;
  content?: string;
}): Response {
  const status = opts?.status ?? 200;
  const body = opts?.noFunctionCall
    ? JSON.stringify({
        choices: [
          { message: { content: opts?.content ?? "plain answer" }, finish_reason: "stop" },
        ],
      })
    : JSON.stringify({
        choices: [
          {
            message: {
              content: opts?.content ?? "",
              function_call: {
                name: "lookup_section",
                arguments: opts?.fnArgs ?? '{"section":"km 10+000"}',
              },
            },
            finish_reason: "function_call",
          },
        ],
      });
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function yandexResponse(opts?: { status?: number; noToolCalls?: boolean; content?: string }): Response {
  const status = opts?.status ?? 200;
  const body = opts?.noToolCalls
    ? JSON.stringify({
        result: {
          alternatives: [
            { message: { role: "assistant", text: opts?.content ?? "plain answer" }, status: "ALTERNATIVE_STATUS_FINAL" },
          ],
        },
      })
    : JSON.stringify({
        result: {
          alternatives: [
            {
              message: {
                role: "assistant",
                text: opts?.content ?? "",
                toolCallList: {
                  toolCalls: [
                    {
                      functionCall: {
                        name: "lookup_section",
                        arguments: { section: "km 10+000" },
                      },
                    },
                  ],
                },
              },
              status: "ALTERNATIVE_STATUS_TOOL_CALLS",
            },
          ],
        },
      });
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("GigaChatProvider.chatWithTools", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GIGACHAT_CLIENT_ID = "test-id";
    process.env.GIGACHAT_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("advertises native tool support", () => {
    const provider = new GigaChatProvider();
    expect(provider.supportsToolCalls).toBe(true);
  });

  it("normalises a function_call response into toolCalls[]", async () => {
    const provider = new GigaChatProvider();
    // Pre-seed token so we don't need to stub the OAuth endpoint.
    // @ts-expect-error -- touching private for test isolation
    provider.accessToken = "seeded";
    // @ts-expect-error
    provider.tokenExpiresAt = Date.now() + 60_000;

    const captured: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      captured.push({ url: String(input), body: init?.body });
      return gigachatResponse();
    }) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "find km 10" }],
      { tools: TOOLS, toolChoice: "auto", model: "GigaChat-Max" }
    );

    expect(result.model).toBe("GigaChat-Max");
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("lookup_section");
    expect(result.toolCalls[0].function.arguments).toBe('{"section":"km 10+000"}');
    const parsedBody = JSON.parse(String(captured[0]?.body));
    expect(parsedBody.functions).toHaveLength(1);
    expect(parsedBody.functions[0].name).toBe("lookup_section");
    expect(parsedBody.function_call).toBe("auto");
  });

  it("stringifies object-shaped arguments", async () => {
    const provider = new GigaChatProvider();
    // @ts-expect-error
    provider.accessToken = "seeded";
    // @ts-expect-error
    provider.tokenExpiresAt = Date.now() + 60_000;

    globalThis.fetch = vi.fn(async () => gigachatResponse({
      fnArgs: { section: "km 10+000", urgent: true },
    })) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "x" }],
      { tools: TOOLS }
    );
    expect(result.toolCalls[0].function.arguments).toContain("km 10+000");
    expect(() => JSON.parse(result.toolCalls[0].function.arguments)).not.toThrow();
  });

  it("falls back to the next tool-capable model on 5xx", async () => {
    const provider = new GigaChatProvider();
    // @ts-expect-error
    provider.accessToken = "seeded";
    // @ts-expect-error
    provider.tokenExpiresAt = Date.now() + 60_000;

    const calls: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      calls.push(Date.now());
      if (calls.length === 1) return gigachatResponse({ status: 503 });
      return gigachatResponse();
    }) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "x" }],
      { tools: TOOLS, model: "GigaChat-Pro" }
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(result.hasToolCalls).toBe(true);
  });

  it("rethrows terminal 4xx errors without fallback", async () => {
    const provider = new GigaChatProvider();
    // @ts-expect-error
    provider.accessToken = "seeded";
    // @ts-expect-error
    provider.tokenExpiresAt = Date.now() + 60_000;

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("bad params", { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      provider.chatWithTools([{ role: "user", content: "x" }], { tools: TOOLS })
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("returns a plain answer when the model declines to call a function", async () => {
    const provider = new GigaChatProvider();
    // @ts-expect-error
    provider.accessToken = "seeded";
    // @ts-expect-error
    provider.tokenExpiresAt = Date.now() + 60_000;

    globalThis.fetch = vi.fn(async () => gigachatResponse({
      noFunctionCall: true,
      content: "No section needed",
    })) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "hi" }],
      { tools: TOOLS }
    );
    expect(result.hasToolCalls).toBe(false);
    expect(result.content).toBe("No section needed");
  });
});

describe("YandexGPTProvider.chatWithTools", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.YANDEXGPT_API_KEY = "test-key";
    process.env.YANDEX_FOLDER_ID = "b1gtest";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("advertises native tool support", () => {
    const provider = new YandexGPTProvider();
    expect(provider.supportsToolCalls).toBe(true);
  });

  it("normalises toolCallList into toolCalls[] with stringified arguments", async () => {
    const provider = new YandexGPTProvider();
    const captured: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      captured.push({ url: String(input), body: init?.body });
      return yandexResponse();
    }) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "find km 10" }],
      { tools: TOOLS, model: "yandexgpt" }
    );

    expect(result.model).toBe("yandexgpt");
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("lookup_section");
    // arguments serialised from object
    expect(() => JSON.parse(result.toolCalls[0].function.arguments)).not.toThrow();
    const parsedArgs = JSON.parse(result.toolCalls[0].function.arguments);
    expect(parsedArgs.section).toBe("km 10+000");

    const sentBody = JSON.parse(String(captured[0]?.body));
    expect(sentBody.modelUri).toMatch(/^gpt:\/\/b1gtest\/yandexgpt$/);
    expect(sentBody.messages[0].text).toBe("find km 10");
    expect(sentBody.tools[0].function.name).toBe("lookup_section");
  });

  it("falls back to yandexgpt-32k on 500 from yandexgpt", async () => {
    const provider = new YandexGPTProvider();
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return yandexResponse({ status: 500 });
      return yandexResponse();
    }) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "x" }],
      { tools: TOOLS, model: "yandexgpt" }
    );
    expect(call).toBe(2);
    expect(result.model).toBe("yandexgpt-32k");
    expect(result.hasToolCalls).toBe(true);
  });

  it("surfaces 4xx without retrying", async () => {
    const provider = new YandexGPTProvider();
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      provider.chatWithTools([{ role: "user", content: "x" }], { tools: TOOLS })
    ).rejects.toThrow(/403/);
    expect(call).toBe(1);
  });

  it("returns empty toolCalls[] when the model answers without calling a tool", async () => {
    const provider = new YandexGPTProvider();
    globalThis.fetch = vi.fn(async () =>
      yandexResponse({ noToolCalls: true, content: "just a text answer" })
    ) as unknown as typeof fetch;

    const result = await provider.chatWithTools(
      [{ role: "user", content: "x" }],
      { tools: TOOLS }
    );
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.content).toBe("just a text answer");
  });
});
