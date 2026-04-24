/**
 * AI Tools Index
 * Canonical adapter over the kernel tool plane.
 */
import type { AITool, JSONSchema, ToolResult } from "./types";
import { createTaskTool, listTasksTool, updateTaskStatusTool, assignTaskTool, deleteTaskTool, taskTools } from "./task-tools";
import { projectTools } from "./project-tools";
import { analyticsTools } from "./analytics-tools";
export type { AITool, ToolResult, JSONSchema, JSONSchemaProperty, ToolExecutionContext } from "./types";
export { createTaskTool, listTasksTool, updateTaskStatusTool, assignTaskTool, deleteTaskTool, };
export { taskTools, projectTools, analyticsTools };
export declare const allTools: AITool[];
export declare const toolRegistry: Record<string, AITool>;
export declare function getTool(name: string): AITool | undefined;
export declare function executeTool(name: string, params: Record<string, unknown> | null | undefined): Promise<ToolResult>;
export declare function getToolDefinitionsForAI(): Array<{
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: JSONSchema;
    };
}>;
//# sourceMappingURL=index.d.ts.map