import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/app/api/middleware/auth", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));

vi.mock("@/lib/ai/kernel-control-plane", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/kernel-control-plane")>();

  return {
    ...actual,
    aiKernelControlPlane: {
      execute: mocks.execute,
    },
  };
});

import { GET, POST } from "@/app/api/ai/kernel/route";

describe("AI kernel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequest.mockResolvedValue(createAuthContext() as never);
    mocks.execute.mockResolvedValue(createStatusResponse() as never);
  });

  it("returns kernel status through the unified control plane", async () => {
    const response = await GET(createRequest("GET"));

    expect(response.status).toBe(200);
    expect(mocks.authorizeRequest).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      { operation: "status" },
      expect.objectContaining({
        transport: "http",
        path: "/api/ai/kernel",
        actor: expect.objectContaining({
          userId: "exec-1",
          workspaceId: "executive",
        }),
      })
    );
  });

  it("uses RUN_AI_ACTIONS permission for mutation operations", async () => {
    mocks.execute.mockResolvedValue(
      createRunResponse("run.create", {
        run: {
          id: "run-1",
          agentId: "portfolio-analyst",
          title: "AI Workspace Run",
          prompt: "Проверь проект",
          status: "queued",
          createdAt: "2026-03-25T00:00:00.000Z",
          updatedAt: "2026-03-25T00:00:00.000Z",
          context: {
            type: "project",
            pathname: "/projects/project-1",
            title: "Project 1",
            subtitle: "Kernel test context",
            projectId: "project-1",
          },
        },
      }) as never
    );

    const body = {
      operation: "run.create",
      payload: {
        agent: {
          id: "portfolio-analyst",
          kind: "analyst",
          nameKey: "ai.agents.portfolioAnalyst.name",
          accentClass: "text-sky-500",
          icon: "📊",
          category: "strategic",
        },
        prompt: "Проверь проект",
        context: {
          locale: "ru",
          interfaceLocale: "ru",
          generatedAt: "2026-03-25T00:00:00.000Z",
          activeContext: {
            type: "project",
            pathname: "/projects/project-1",
            title: "Project 1",
            subtitle: "Kernel test context",
            projectId: "project-1",
          },
          projects: [],
          tasks: [],
          team: [],
          risks: [],
          notifications: [],
        },
      },
    };

    const response = await POST(createRequest("POST", body));

    expect(response.status).toBe(200);
    expect(mocks.authorizeRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { permission: "RUN_AI_ACTIONS" }
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        transport: "http",
        path: "/api/ai/kernel",
      })
    );
  });

  it("uses RUN_AI_ACTIONS permission for tool execution", async () => {
    mocks.execute.mockResolvedValue(
      {
        success: true,
        operation: "tool.execute",
        correlationId: "trace-3",
        timestamp: "2026-03-25T00:00:00.000Z",
        data: {
          result: {
            toolCallId: "tool-call-1",
            name: "create_task",
            success: true,
            result: {
              taskId: "task-1",
            },
            displayMessage: "✅ Задача создана",
          },
        },
      } as never
    );

    const body = {
      operation: "tool.execute",
      payload: {
        toolName: "create_task",
        arguments: {
          title: "Подготовить отчёт",
        },
      },
    };

    const response = await POST(createRequest("POST", body));

    expect(response.status).toBe(200);
    expect(mocks.authorizeRequest).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: "RUN_AI_ACTIONS",
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        transport: "http",
        path: "/api/ai/kernel",
      })
    );
  });

  it("rejects unsupported operations before hitting auth or execution", async () => {
    const response = await POST(
      createRequest("POST", {
        operation: "unsupported",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.authorizeRequest).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("propagates normalized error statuses from the control plane", async () => {
    mocks.execute.mockResolvedValue({
      success: false,
      operation: "run.apply",
      correlationId: "trace-1",
      timestamp: "2026-03-25T00:00:00.000Z",
      error: {
        code: "AI_UNAVAILABLE",
        message: "No live AI provider is configured.",
        status: 503,
      },
    } as never);

    const response = await POST(
      createRequest("POST", {
        operation: "run.apply",
        payload: {
          runId: "run-1",
          proposalId: "proposal-1",
        },
      })
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AI_UNAVAILABLE");
  });
});

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

function createRequest(method: "GET" | "POST", body?: unknown) {
  return new NextRequest(
    new Request("http://localhost/api/ai/kernel", {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  );
}

function createStatusResponse() {
  return {
    success: true,
    operation: "status",
    correlationId: "trace-1",
    timestamp: "2026-03-25T00:00:00.000Z",
    data: {
      status: {
        mode: "gateway",
        gatewayKind: "local",
        gatewayAvailable: true,
        providerAvailable: false,
        isProduction: false,
        unavailableReason: null,
      },
      supportedOperations: [
        "status",
        "run.create",
        "run.get",
        "run.list",
        "run.apply",
        "chat.context.build",
        "tool.list",
        "tool.execute",
      ],
    },
  };
}

function createRunResponse(operation: "run.create", data: { run: unknown }) {
  return {
    success: true,
    operation,
    correlationId: "trace-2",
    timestamp: "2026-03-25T00:00:00.000Z",
    data,
  };
}
