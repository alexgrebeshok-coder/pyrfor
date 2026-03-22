import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

import { GET, POST } from "@/app/api/ai/chat/route";

function createAuthContext() {
  return {
    accessProfile: {
      organizationSlug: "ceoclaw-demo",
      userId: "exec-1",
      name: "Executive User",
      role: "EXEC",
      workspaceId: "executive",
    },
    workspace: {
      id: "executive",
    },
  };
}

function createPostRequest(body: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

describe("AI chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
  });

  it("responds with the local-model result when authorization succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "AI ответ в dev mode.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const response = await POST(
      createPostRequest({
        messages: [{ role: "user", content: "Привет, AI!" }],
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      response: string;
      provider: string;
      model: string;
    };

    expect(body.success).toBe(true);
    expect(body.response).toBe("AI ответ в dev mode.");
    expect(body.provider).toBe("local");
    expect(body.model).toBe("v10");
    expect(mocks.authorizeRequest).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("returns the static GET status payload", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      provider: string;
      fallback: string;
    };

    expect(body).toEqual({
      status: "ok",
      provider: "local-first",
      fallback: "zai",
    });
  });
});
