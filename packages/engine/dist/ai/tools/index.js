/**
 * AI Tools Index
 * Canonical adapter over the kernel tool plane.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { executeAIKernelTool, getAIKernelToolDefinitions, listAIKernelTools, } from '../kernel-tool-plane';
import { createTaskTool, listTasksTool, updateTaskStatusTool, assignTaskTool, deleteTaskTool, taskTools, } from "./task-tools";
import { projectTools } from "./project-tools";
import { analyticsTools } from "./analytics-tools";
export { createTaskTool, listTasksTool, updateTaskStatusTool, assignTaskTool, deleteTaskTool, };
export { taskTools, projectTools, analyticsTools };
export const allTools = listAIKernelTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield executeAIKernelTool({
                toolName: tool.name,
                arguments: params,
            });
            return normalizeToolResult(result.result, result.success, result.displayMessage);
        });
    },
}));
export const toolRegistry = Object.fromEntries(allTools.map((tool) => [tool.name, tool]));
export function getTool(name) {
    return toolRegistry[name];
}
export function executeTool(name, params) {
    return __awaiter(this, void 0, void 0, function* () {
        const tool = getTool(name);
        if (!tool) {
            return {
                success: false,
                error: `Tool not found: ${name}`,
            };
        }
        return tool.execute(params !== null && params !== void 0 ? params : {});
    });
}
export function getToolDefinitionsForAI() {
    return getAIKernelToolDefinitions().map((tool) => ({
        type: "function",
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        },
    }));
}
function normalizeToolResult(result, success, displayMessage) {
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
