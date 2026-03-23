import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAIChat } from "@/hooks/use-ai-chat";

function createJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("useAIChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures run metadata from the JSON chat response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        success: true,
        response: "Готово.",
        provider: "openrouter",
        model: "openai/gpt-4o-mini",
        runId: "ai-run-123",
        status: "done",
        facts: [
          {
            label: "Project",
            value: "Project Alpha · 63% health · 58% progress",
          },
        ],
        confidence: {
          score: 84,
          band: "high",
          label: "High",
          rationale: "Grounded in 2 tasks · 1 blocked.",
          basis: ["2 tasks", "1 blocked"],
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() =>
      useAIChat({
        provider: "openrouter",
        projectId: "project-1",
      })
    );

    await act(async () => {
      await result.current.sendMessage("Проверь проект");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        method: "POST",
      })
    );

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      messages: Array<{ role: string; content: string }>;
      stream: boolean;
      provider: string;
      projectId: string;
    };

    expect(payload).toEqual(
      expect.objectContaining({
        stream: false,
        provider: "openrouter",
        projectId: "project-1",
      })
    );
    expect(payload.messages).toEqual([
      {
        role: "user",
        content: "Проверь проект",
      },
    ]);

    expect(result.current.messages).toHaveLength(2);

    const assistantMessage = result.current.messages[1];
    expect(assistantMessage.content).toBe("Готово.");
    expect(assistantMessage.meta).toEqual(
      expect.objectContaining({
        success: true,
        provider: "openrouter",
        model: "openai/gpt-4o-mini",
      })
    );
    expect(assistantMessage.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Project",
          value: expect.stringContaining("Project Alpha"),
        }),
      ])
    );
    expect(assistantMessage.confidence).toEqual(
      expect.objectContaining({
        score: 84,
        band: "high",
      })
    );
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
