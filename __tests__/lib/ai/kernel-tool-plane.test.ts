import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
}));

vi.mock("@/lib/ai/tool-executor", () => ({
  executeToolCall: mocks.executeToolCall,
}));

import {
  executeAIKernelTool,
  executeAIKernelToolCall,
  getAIKernelToolDefinitions,
  listAIKernelTools,
  validateAIKernelToolRequest,
} from "@/lib/ai/kernel-tool-plane";

describe("AI kernel tool plane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists canonical kernel tools from the active AI tool catalog", () => {
    const tools = listAIKernelTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name)).toContain("create_task");
    expect(getAIKernelToolDefinitions()).toHaveLength(tools.length);
  });

  it("validates tool names and arguments before execution", () => {
    expect(
      validateAIKernelToolRequest({
        toolName: "missing_tool",
        arguments: {},
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "UNKNOWN_TOOL",
      })
    );

    expect(
      validateAIKernelToolRequest({
        toolName: "create_task",
        arguments: {},
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "INVALID_TOOL_ARGUMENTS",
      })
    );
  });

  it("returns a validation failure without touching the legacy executor", async () => {
    const result = await executeAIKernelTool({
      toolName: "create_task",
      arguments: {},
      toolCallId: "tool-call-1",
    });

    expect(result.success).toBe(false);
    expect(result.result.error).toBe("Missing required parameter: title");
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });

  it("delegates valid tool execution through the legacy executor", async () => {
    mocks.executeToolCall.mockResolvedValue({
      toolCallId: "tool-call-2",
      name: "create_task",
      success: true,
      result: {
        taskId: "task-1",
      },
      displayMessage: "✅ Задача создана",
    } as never);

    const result = await executeAIKernelTool({
      toolName: "create_task",
      arguments: {
        title: "Подготовить отчёт",
      },
      toolCallId: "tool-call-2",
    });

    expect(result.success).toBe(true);
    expect(mocks.executeToolCall).toHaveBeenCalledWith({
      id: "tool-call-2",
      type: "function",
      function: {
        name: "create_task",
        arguments: JSON.stringify({
          title: "Подготовить отчёт",
        }),
      },
    });
  });

  it("rejects malformed JSON tool calls before delegating", async () => {
    const result = await executeAIKernelToolCall({
      id: "tool-call-3",
      type: "function",
      function: {
        name: "create_task",
        arguments: "{",
      },
    });

    expect(result.success).toBe(false);
    expect(result.result.error).toBe("Invalid JSON arguments");
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });
});
