/**
 * AI Tools Index
 * Canonical adapter over the kernel tool plane.
 */

import {
  executeAIKernelTool,
  getAIKernelToolDefinitions,
  listAIKernelTools,
} from '../kernel-tool-plane';
import type { AITool, JSONSchema, ToolResult } from "./types";
import {
  createTaskTool,
  listTasksTool,
  updateTaskStatusTool,
  assignTaskTool,
  deleteTaskTool,
  taskTools,
} from "./task-tools";
import { projectTools } from "./project-tools";
import { analyticsTools } from "./analytics-tools";

export type { AITool, ToolResult, JSONSchema, JSONSchemaProperty, ToolExecutionContext } from "./types";

export {
  createTaskTool,
  listTasksTool,
  updateTaskStatusTool,
  assignTaskTool,
  deleteTaskTool,
};

export { taskTools, projectTools, analyticsTools };

export const allTools: AITool[] = listAIKernelTools().map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const result = await executeAIKernelTool({
      toolName: tool.name,
      arguments: params,
    });

    return normalizeToolResult(result.result, result.success, result.displayMessage);
  },
}));

export const toolRegistry: Record<string, AITool> = Object.fromEntries(
  allTools.map((tool) => [tool.name, tool])
);

export function getTool(name: string): AITool | undefined {
  return toolRegistry[name];
}

export async function executeTool(
  name: string,
  params: Record<string, unknown> | null | undefined
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return {
      success: false,
      error: `Tool not found: ${name}`,
    };
  }

  return tool.execute(params ?? {});
}

export function getToolDefinitionsForAI(): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}> {
  return getAIKernelToolDefinitions().map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as unknown as JSONSchema,
    },
  }));
}

function normalizeToolResult(
  result: Record<string, unknown>,
  success: boolean,
  displayMessage: string
): ToolResult {
  if (success) {
    return {
      success: true,
      data: result,
    };
  }

  const error = typeof result.error === "string" ? result.error : displayMessage;
  return {
    success: false,
    error,
  };
}
