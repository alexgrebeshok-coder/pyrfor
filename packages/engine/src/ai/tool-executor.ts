/**
 * AI Tool Executor — thin dispatcher over canonical tool domain services
 */

import { financeToolService } from './tool-services/finance-service';
import { inventoryToolService } from './tool-services/inventory-service';
import { ensureBuiltinPluginsRegistered, getPlugin, executePlugin } from './plugin-system';
import { projectToolService } from './tool-services/project-service';
import { schedulingToolService } from './tool-services/scheduling-service';
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
  ensureBuiltinPluginsRegistered();
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
    const plugin = getPlugin(call.function.name);
    if (plugin) {
      const pluginResult = await executePlugin(call.function.name, args);
      return {
        toolCallId: call.id,
        name,
        success: pluginResult.success,
        result: pluginResult.success
          ? ((pluginResult.data as Record<string, unknown> | undefined) ?? {})
          : { error: pluginResult.error ?? "Plugin execution failed" },
        displayMessage: pluginResult.success
          ? `✅ Plugin ${call.function.name} executed`
          : `❌ Plugin ${call.function.name}: ${pluginResult.error ?? "execution failed"}`,
      };
    }

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
