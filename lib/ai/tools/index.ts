/**
 * AI Tools Index
 * Export all AI agent tools
 */

import type { AITool } from "./types";
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
import { validateToolParameters } from "./validation";

// Re-export types
export type { AITool, ToolResult, JSONSchema, JSONSchemaProperty, ToolExecutionContext } from "./types";

// Re-export individual tools
export {
  createTaskTool,
  listTasksTool,
  updateTaskStatusTool,
  assignTaskTool,
  deleteTaskTool,
};

// Export tool collections
export { taskTools, projectTools, analyticsTools };

/**
 * All available AI tools
 */
export const allTools: AITool[] = [
  ...taskTools,
  ...projectTools,
  ...analyticsTools,
];

/**
 * Tool registry for quick lookup by name
 */
export const toolRegistry: Record<string, AITool> = Object.fromEntries(
  allTools.map((tool) => [tool.name, tool])
);

/**
 * Get tool by name
 */
export function getTool(name: string): AITool | undefined {
  return toolRegistry[name];
}

/**
 * Execute a tool by name with parameters
 */
export async function executeTool(
  name: string,
  params: Record<string, unknown> | null | undefined
): Promise<import("./types").ToolResult> {
  const tool = getTool(name);
  
  if (!tool) {
    return {
      success: false,
      error: `Tool not found: ${name}`,
    };
  }
  
  const normalizedParams = params ?? {};
  const validationError = validateToolParameters(tool.parameters, normalizedParams);
  if (validationError) {
    return {
      success: false,
      error: validationError,
    };
  }
  
  return tool.execute(normalizedParams);
}

/**
 * Get all tool definitions in OpenAI format
 */
export function getToolDefinitionsForAI(): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: import("./types").JSONSchema;
  };
}> {
  return allTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
