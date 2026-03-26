/**
 * AI Tool Executor — thin dispatcher over canonical tool domain services
 */

import { financeToolService } from "@/lib/ai/tool-services/finance-service";
import { inventoryToolService } from "@/lib/ai/tool-services/inventory-service";
import { projectToolService } from "@/lib/ai/tool-services/project-service";
import { schedulingToolService } from "@/lib/ai/tool-services/scheduling-service";
import type { AIToolCall, AIToolName, AIToolResult } from "./tools";

type ToolHandler = (toolCallId: string, args: Record<string, unknown>) => Promise<AIToolResult>;

const TOOL_HANDLERS: Record<AIToolName, ToolHandler> = {
  create_task: projectToolService.createTask,
  create_risk: projectToolService.createRisk,
  update_task: projectToolService.updateTask,
  get_project_summary: projectToolService.getProjectSummary,
  list_tasks: projectToolService.listTasks,
  generate_brief: projectToolService.generateBrief,
  create_expense: financeToolService.createExpense,
  get_budget_summary: financeToolService.getBudgetSummary,
  list_equipment: inventoryToolService.listEquipment,
  create_material_movement: inventoryToolService.createMaterialMovement,
  get_critical_path: schedulingToolService.getCriticalPath,
  get_resource_load: schedulingToolService.getResourceLoad,
  sync_1c: (toolCallId) => financeToolService.syncOneC(toolCallId),
};

export async function executeToolCall(call: AIToolCall): Promise<AIToolResult> {
  const name = call.function.name as AIToolName;
  const handler = TOOL_HANDLERS[name];

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return {
      toolCallId: call.id,
      name,
      success: false,
      result: { error: "Invalid JSON arguments" },
      displayMessage: "❌ Ошибка: некорректные аргументы",
    };
  }

  if (!handler) {
    return {
      toolCallId: call.id,
      name,
      success: false,
      result: { error: `Unknown tool: ${name}` },
      displayMessage: `❌ Неизвестный инструмент: ${name}`,
    };
  }

  try {
    return await handler(call.id, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolCallId: call.id,
      name,
      success: false,
      result: { error: message },
      displayMessage: `❌ Ошибка: ${message}`,
    };
  }
}

export async function executeToolCalls(calls: AIToolCall[]): Promise<AIToolResult[]> {
  return Promise.all(calls.map(executeToolCall));
}
