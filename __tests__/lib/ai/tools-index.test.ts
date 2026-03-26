import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAIKernelTools: vi.fn(() => [
    {
      type: "function",
      name: "create_task",
      description: "Create task",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
          },
        },
        required: ["title"],
      },
      domain: "project",
      mode: "mutation",
      source: "kernel-tool-plane",
    },
  ]),
  getAIKernelToolDefinitions: vi.fn(() => [
    {
      type: "function",
      function: {
        name: "create_task",
        description: "Create task",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
            },
          },
          required: ["title"],
        },
      },
    },
  ]),
  executeAIKernelTool: vi.fn(),
}));

vi.mock("@/lib/ai/kernel-tool-plane", () => ({
  listAIKernelTools: mocks.listAIKernelTools,
  getAIKernelToolDefinitions: mocks.getAIKernelToolDefinitions,
  executeAIKernelTool: mocks.executeAIKernelTool,
}));

import { allTools, executeTool, getToolDefinitionsForAI } from "@/lib/ai/tools/index";

describe("AI tools index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeAIKernelTool.mockResolvedValue({
      toolCallId: "tool-call-1",
      name: "create_task",
      success: true,
      result: {
        taskId: "task-1",
      },
      displayMessage: "ok",
    } as never);
  });

  it("builds exported tool definitions from the canonical kernel tool plane", () => {
    expect(allTools).toHaveLength(1);
    expect(allTools[0]?.name).toBe("create_task");
    expect(getToolDefinitionsForAI()).toEqual([
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Create task",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
              },
            },
            required: ["title"],
          },
        },
      },
    ]);
  });

  it("executes tools via the canonical kernel tool plane", async () => {
    const result = await executeTool("create_task", {
      title: "Подготовить отчёт",
    });

    expect(result).toEqual({
      success: true,
      data: {
        taskId: "task-1",
      },
    });
    expect(mocks.executeAIKernelTool).toHaveBeenCalledWith({
      toolName: "create_task",
      arguments: {
        title: "Подготовить отчёт",
      },
    });
  });
});
