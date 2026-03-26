import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectToolService: {
    createTask: vi.fn(),
    createRisk: vi.fn(),
    updateTask: vi.fn(),
    getProjectSummary: vi.fn(),
    listTasks: vi.fn(),
    generateBrief: vi.fn(),
  },
  financeToolService: {
    createExpense: vi.fn(),
    getBudgetSummary: vi.fn(),
    syncOneC: vi.fn(),
  },
  inventoryToolService: {
    listEquipment: vi.fn(),
    createMaterialMovement: vi.fn(),
  },
  schedulingToolService: {
    getCriticalPath: vi.fn(),
    getResourceLoad: vi.fn(),
  },
}));

vi.mock("@/lib/ai/tool-services/project-service", () => ({
  projectToolService: mocks.projectToolService,
}));

vi.mock("@/lib/ai/tool-services/finance-service", () => ({
  financeToolService: mocks.financeToolService,
}));

vi.mock("@/lib/ai/tool-services/inventory-service", () => ({
  inventoryToolService: mocks.inventoryToolService,
}));

vi.mock("@/lib/ai/tool-services/scheduling-service", () => ({
  schedulingToolService: mocks.schedulingToolService,
}));

import { executeToolCall, executeToolCalls } from "@/lib/ai/tool-executor";

describe("AI tool executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectToolService.createTask.mockResolvedValue(createToolResult("create_task") as never);
    mocks.financeToolService.syncOneC.mockResolvedValue(createToolResult("sync_1c") as never);
  });

  it("dispatches create_task to the project tool service", async () => {
    const result = await executeToolCall({
      id: "tool-call-1",
      type: "function",
      function: {
        name: "create_task",
        arguments: JSON.stringify({
          title: "Подготовить отчёт",
        }),
      },
    });

    expect(result.success).toBe(true);
    expect(mocks.projectToolService.createTask).toHaveBeenCalledWith("tool-call-1", {
      title: "Подготовить отчёт",
    });
  });

  it("returns an error for malformed JSON before dispatching", async () => {
    const result = await executeToolCall({
      id: "tool-call-2",
      type: "function",
      function: {
        name: "create_task",
        arguments: "{",
      },
    });

    expect(result.success).toBe(false);
    expect(result.result.error).toBe("Invalid JSON arguments");
    expect(mocks.projectToolService.createTask).not.toHaveBeenCalled();
  });

  it("dispatches batched calls through the registered handlers", async () => {
    const results = await executeToolCalls([
      {
        id: "tool-call-3",
        type: "function",
        function: {
          name: "create_task",
          arguments: JSON.stringify({ title: "Подготовить отчёт" }),
        },
      },
      {
        id: "tool-call-4",
        type: "function",
        function: {
          name: "sync_1c",
          arguments: JSON.stringify({}),
        },
      },
    ]);

    expect(results).toHaveLength(2);
    expect(mocks.projectToolService.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.financeToolService.syncOneC).toHaveBeenCalledWith("tool-call-4");
  });
});

function createToolResult(name: "create_task" | "sync_1c") {
  return {
    toolCallId: `${name}-call`,
    name,
    success: true,
    result: {
      ok: true,
    },
    displayMessage: "ok",
  };
}
