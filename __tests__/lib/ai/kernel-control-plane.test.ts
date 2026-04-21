import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAIUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AIUnavailableError";
    }
  }

  return {
    AIUnavailableError: MockAIUnavailableError,
    getServerAIStatus: vi.fn(),
    createServerAIRun: vi.fn(),
    getServerAIRun: vi.fn(),
    getServerAIRunEntry: vi.fn(),
    listServerAIRunEntries: vi.fn(),
    applyServerAIProposal: vi.fn(),
    buildKernelChatContext: vi.fn(),
    listAIKernelTools: vi.fn(),
    executeAIKernelTool: vi.fn(),
  };
});

vi.mock("@/lib/ai/server-runs", () => ({
  AIUnavailableError: mocks.AIUnavailableError,
  getServerAIStatus: mocks.getServerAIStatus,
  createServerAIRun: mocks.createServerAIRun,
  getServerAIRun: mocks.getServerAIRun,
  getServerAIRunEntry: mocks.getServerAIRunEntry,
  listServerAIRunEntries: mocks.listServerAIRunEntries,
  applyServerAIProposal: mocks.applyServerAIProposal,
}));

vi.mock("@/lib/ai/kernel-context-stack", () => ({
  buildKernelChatContext: mocks.buildKernelChatContext,
}));

vi.mock("@/lib/ai/kernel-tool-plane", () => ({
  listAIKernelTools: mocks.listAIKernelTools,
  executeAIKernelTool: mocks.executeAIKernelTool,
  validateAIKernelToolRequest: vi.fn((input: { toolName?: unknown; arguments?: unknown }) => {
    if (typeof input.toolName !== "string" || input.toolName.trim().length === 0) {
      return {
        ok: false,
        code: "TOOL_NAME_REQUIRED",
        message: "A valid AI tool name is required.",
      };
    }

    if (input.toolName !== "create_task") {
      return {
        ok: false,
        code: "UNKNOWN_TOOL",
        message: `Unknown AI tool: ${input.toolName}`,
      };
    }

    if (
      input.arguments !== undefined &&
      (typeof input.arguments !== "object" || input.arguments === null || Array.isArray(input.arguments))
    ) {
      return {
        ok: false,
        code: "INVALID_TOOL_ARGUMENTS",
        message: "AI tool arguments must be an object.",
      };
    }

    const args = (input.arguments ?? {}) as Record<string, unknown>;
    if (typeof args.title !== "string" || args.title.trim().length === 0) {
      return {
        ok: false,
        code: "INVALID_TOOL_ARGUMENTS",
        message: "Missing required parameter: title",
      };
    }

    return {
      ok: true,
      descriptor: {
        type: "function",
        name: "create_task",
        description: "Create task",
        parameters: {
          type: "object",
          properties: {},
          required: ["title"],
        },
        source: "legacy-ai-tools",
      },
      arguments: args,
    };
  }),
}));

import {
  AI_KERNEL_OPERATIONS,
  AIKernelControlPlane,
} from "@/lib/ai/kernel-control-plane";
import type { AIRunInput } from "@/lib/ai/types";

describe("AI kernel control plane", () => {
  const controlPlane = new AIKernelControlPlane();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerAIStatus.mockReturnValue(createAIStatus());
    mocks.listAIKernelTools.mockReturnValue([createKernelToolDescriptor()] as never);
  });

  it("returns status with supported operations", async () => {
    const result = await controlPlane.execute(
      { operation: "status" },
      { correlationId: "trace-1" }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.correlationId).toBe("trace-1");
    expect(result.data.status).toEqual(createAIStatus());
    expect(result.data.supportedOperations).toEqual(AI_KERNEL_OPERATIONS);
    expect(mocks.getServerAIStatus).toHaveBeenCalledTimes(1);
  });

  it("creates runs through the existing server-runs service", async () => {
    mocks.createServerAIRun.mockResolvedValue(createRun("run-1") as never);

    const result = await controlPlane.execute({
      operation: "run.create",
      payload: createRunInput(),
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.correlationId).toMatch(/^kernel-/);
    expect(result.data.run.id).toBe("run-1");
    expect(mocks.createServerAIRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Проверь проект",
        agent: expect.objectContaining({ id: "portfolio-analyst" }),
      })
    );
  });

  it("lists existing runs without changing their shape", async () => {
    mocks.listServerAIRunEntries.mockResolvedValue([
      { run: createRun("run-1") },
      { run: createRun("run-2") },
    ] as never);

    const result = await controlPlane.execute({ operation: "run.list" });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.data.count).toBe(2);
    expect(result.data.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
  });

  it("builds chat context and augmented messages through the shared context builder", async () => {
    mocks.buildKernelChatContext.mockResolvedValue({
      bundle: createContextBundle(),
      messages: [
        { role: "system", content: "Ты CEOClaw AI" },
        { role: "user", content: "Покажи риски" },
      ],
      assembly: {
        source: "live",
        scope: "project",
        projectId: "project-1",
        memoryCount: 1,
        issueCount: 0,
        issues: [],
      },
    } as never);

    const result = await controlPlane.execute({
      operation: "chat.context.build",
      payload: {
        messages: [{ role: "user", content: "Покажи риски" }],
        projectId: "project-1",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.data.bundle.projectId).toBe("project-1");
    expect(result.data.messages).toHaveLength(2);
    expect(result.data.assembly.memoryCount).toBe(1);
    expect(mocks.buildKernelChatContext).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        messages: [{ role: "user", content: "Покажи риски" }],
      })
    );
  });

  it("lists canonical tools through the kernel tool plane", async () => {
    const result = await controlPlane.execute({ operation: "tool.list" });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.data.count).toBe(1);
    expect(result.data.tools[0]?.name).toBe("create_task");
    expect(mocks.listAIKernelTools).toHaveBeenCalledTimes(1);
  });

  it("executes tools through the canonical kernel tool plane", async () => {
    mocks.executeAIKernelTool.mockResolvedValue({
      toolCallId: "tool-call-1",
      name: "create_task",
      success: true,
      result: {
        taskId: "task-1",
      },
      displayMessage: "✅ Задача создана",
    } as never);

    const result = await controlPlane.execute({
      operation: "tool.execute",
      payload: {
        toolName: "create_task",
        arguments: {
          title: "Подготовить отчёт",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success response");
    }

    expect(result.data.result.success).toBe(true);
    expect(mocks.executeAIKernelTool).toHaveBeenCalledWith({
      toolName: "create_task",
      arguments: {
        title: "Подготовить отчёт",
      },
    });
  });

  it("returns validation errors without calling downstream services", async () => {
    const result = await controlPlane.execute({
      operation: "run.apply",
      payload: {
        runId: "run-1",
        proposalId: "",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure response");
    }

    expect(result.error).toEqual(
      expect.objectContaining({
        code: "PROPOSAL_ID_REQUIRED",
        status: 400,
      })
    );
    expect(mocks.applyServerAIProposal).not.toHaveBeenCalled();
  });

  it("rejects invalid tool payloads before hitting the tool executor", async () => {
    const result = await controlPlane.execute({
      operation: "tool.execute",
      payload: {
        toolName: "create_task",
        arguments: {},
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure response");
    }

    expect(result.error).toEqual(
      expect.objectContaining({
        code: "INVALID_TOOL_ARGUMENTS",
        status: 400,
      })
    );
    expect(mocks.executeAIKernelTool).not.toHaveBeenCalled();
  });

  it("stamps actor workspace/user onto run.create payloads", async () => {
    mocks.createServerAIRun.mockResolvedValue(createRun("run-ws-1") as never);

    const result = await controlPlane.execute(
      {
        operation: "run.create",
        payload: createRunInput(),
      },
      {
        actor: {
          userId: "user-42",
          workspaceId: "ws-alpha",
          role: "admin",
        },
      }
    );

    expect(result.success).toBe(true);
    expect(mocks.createServerAIRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-alpha",
        ownerUserId: "user-42",
      })
    );
  });

  it("rejects run.get when the actor's workspace differs from the run's", async () => {
    mocks.getServerAIRunEntry.mockResolvedValue({
      origin: "provider",
      input: { ...createRunInput(), workspaceId: "ws-other" },
      run: createRun("run-ws-x"),
    } as never);

    const result = await controlPlane.execute(
      { operation: "run.get", payload: { runId: "run-ws-x" } },
      { actor: { userId: "user-42", workspaceId: "ws-alpha" } }
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toEqual(
      expect.objectContaining({ code: "FORBIDDEN_WORKSPACE", status: 403 })
    );
  });

  it("filters run.list results to the actor's workspace, keeping legacy untagged runs", async () => {
    mocks.listServerAIRunEntries.mockResolvedValue([
      { origin: "provider", input: { ...createRunInput(), workspaceId: "ws-alpha" }, run: createRun("run-1") },
      { origin: "provider", input: { ...createRunInput(), workspaceId: "ws-other" }, run: createRun("run-2") },
      { origin: "provider", input: createRunInput(), run: createRun("run-legacy") }, // no workspace tag
    ] as never);

    const result = await controlPlane.execute(
      { operation: "run.list" },
      { actor: { userId: "user-42", workspaceId: "ws-alpha" } }
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    const ids = result.data.runs.map((r) => r.id).sort();
    expect(ids).toEqual(["run-1", "run-legacy"]);
    expect(result.data.count).toBe(2);
  });

  it("allows run.apply when the actor's workspace matches the run's workspace", async () => {
    mocks.getServerAIRunEntry.mockResolvedValue({
      origin: "provider",
      input: { ...createRunInput(), workspaceId: "ws-alpha" },
      run: createRun("run-allowed"),
    } as never);
    mocks.applyServerAIProposal.mockResolvedValue(createRun("run-allowed") as never);

    const result = await controlPlane.execute(
      {
        operation: "run.apply",
        payload: { runId: "run-allowed", proposalId: "proposal-1" },
      },
      { actor: { userId: "user-42", workspaceId: "ws-alpha" } }
    );

    expect(result.success).toBe(true);
    expect(mocks.applyServerAIProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-allowed",
        proposalId: "proposal-1",
        operatorId: "user-42",
      })
    );
  });

  it("maps AI availability failures into a normalized error", async () => {
    mocks.createServerAIRun.mockRejectedValue(
      new mocks.AIUnavailableError("No live AI provider is configured.")
    );

    const result = await controlPlane.execute({
      operation: "run.create",
      payload: createRunInput(),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure response");
    }

    expect(result.error).toEqual(
      expect.objectContaining({
        code: "AI_UNAVAILABLE",
        status: 503,
        message: "No live AI provider is configured.",
      })
    );
  });

  describe("AI_KERNEL_REJECT_LEGACY_UNTAGGED flag", () => {
    const originalFlag = process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED;

    beforeEach(() => {
      process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED = "true";
    });

    afterEach(() => {
      if (originalFlag === undefined) {
        delete process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED;
      } else {
        process.env.AI_KERNEL_REJECT_LEGACY_UNTAGGED = originalFlag;
      }
    });

    it("rejects run.get on legacy untagged runs when the flag is enabled", async () => {
      mocks.getServerAIRunEntry.mockResolvedValue({
        origin: "provider",
        input: createRunInput(), // no workspaceId
        run: createRun("run-legacy-reject"),
      } as never);

      const result = await controlPlane.execute(
        { operation: "run.get", payload: { runId: "run-legacy-reject" } },
        { actor: { userId: "user-42", workspaceId: "ws-alpha" } }
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toEqual(
        expect.objectContaining({
          code: "FORBIDDEN_WORKSPACE",
          status: 403,
          details: expect.objectContaining({ reason: "legacy_untagged" }),
        })
      );
    });

    it("excludes legacy untagged runs from run.list when the flag is enabled", async () => {
      mocks.listServerAIRunEntries.mockResolvedValue([
        {
          origin: "provider",
          input: { ...createRunInput(), workspaceId: "ws-alpha" },
          run: createRun("run-tagged"),
        },
        {
          origin: "provider",
          input: createRunInput(),
          run: createRun("run-legacy"),
        },
      ] as never);

      const result = await controlPlane.execute(
        { operation: "run.list" },
        { actor: { userId: "user-42", workspaceId: "ws-alpha" } }
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      const ids = result.data.runs.map((r) => r.id);
      expect(ids).toEqual(["run-tagged"]);
      expect(result.data.count).toBe(1);
    });
  });
});

function createAIStatus() {
  return {
    mode: "gateway",
    gatewayKind: "local",
    gatewayAvailable: true,
    providerAvailable: false,
    isProduction: false,
    unavailableReason: null,
  } as const;
}

function createKernelToolDescriptor() {
  return {
    type: "function",
    name: "create_task",
    description: "Create task",
    parameters: {
      type: "object",
      properties: {},
      required: ["title"],
    },
    source: "legacy-ai-tools",
  } as const;
}

function createRun(runId: string) {
  return {
    id: runId,
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
  };
}

function createRunInput(): AIRunInput {
  return {
    agent: {
      id: "portfolio-analyst",
      kind: "analyst",
      nameKey: "app.name",
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
  };
}

function createContextBundle() {
  return {
    source: "live",
    locale: "ru",
    scope: "project",
    focus: "risk",
    generatedAt: "2026-03-25T00:00:00.000Z",
    projectId: "project-1",
    projectName: "Project 1",
    projectStatus: "active",
    summary: "Project context summary",
    sections: [
      {
        title: "Контекст проекта",
        bullets: ["Проект активен"],
      },
    ],
    evidence: {
      syncedAt: "2026-03-25T00:00:00.000Z",
      summary: {
        total: 0,
        reported: 0,
        observed: 0,
        verified: 0,
        averageConfidence: 0,
        lastObservedAt: null,
      },
      records: [],
    },
    alertFeed: {
      items: [],
      totals: {
        critical: 0,
        warning: 0,
        normal: 0,
      },
    },
    planFact: {
      summary: "Plan-fact summary",
    },
    systemPrompt: "Ты CEOClaw AI",
  };
}
