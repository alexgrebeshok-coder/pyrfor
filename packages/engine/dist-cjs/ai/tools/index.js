"use strict";
/**
 * AI Tools Index
 * Canonical adapter over the kernel tool plane.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolRegistry = exports.allTools = exports.analyticsTools = exports.projectTools = exports.taskTools = exports.deleteTaskTool = exports.assignTaskTool = exports.updateTaskStatusTool = exports.listTasksTool = exports.createTaskTool = void 0;
exports.getTool = getTool;
exports.executeTool = executeTool;
exports.getToolDefinitionsForAI = getToolDefinitionsForAI;
const kernel_tool_plane_1 = require("../kernel-tool-plane");
const task_tools_1 = require("./task-tools");
Object.defineProperty(exports, "createTaskTool", { enumerable: true, get: function () { return task_tools_1.createTaskTool; } });
Object.defineProperty(exports, "listTasksTool", { enumerable: true, get: function () { return task_tools_1.listTasksTool; } });
Object.defineProperty(exports, "updateTaskStatusTool", { enumerable: true, get: function () { return task_tools_1.updateTaskStatusTool; } });
Object.defineProperty(exports, "assignTaskTool", { enumerable: true, get: function () { return task_tools_1.assignTaskTool; } });
Object.defineProperty(exports, "deleteTaskTool", { enumerable: true, get: function () { return task_tools_1.deleteTaskTool; } });
Object.defineProperty(exports, "taskTools", { enumerable: true, get: function () { return task_tools_1.taskTools; } });
const project_tools_1 = require("./project-tools");
Object.defineProperty(exports, "projectTools", { enumerable: true, get: function () { return project_tools_1.projectTools; } });
const analytics_tools_1 = require("./analytics-tools");
Object.defineProperty(exports, "analyticsTools", { enumerable: true, get: function () { return analytics_tools_1.analyticsTools; } });
exports.allTools = (0, kernel_tool_plane_1.listAIKernelTools)().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(params) {
        const result = await (0, kernel_tool_plane_1.executeAIKernelTool)({
            toolName: tool.name,
            arguments: params,
        });
        return normalizeToolResult(result.result, result.success, result.displayMessage);
    },
}));
exports.toolRegistry = Object.fromEntries(exports.allTools.map((tool) => [tool.name, tool]));
function getTool(name) {
    return exports.toolRegistry[name];
}
async function executeTool(name, params) {
    const tool = getTool(name);
    if (!tool) {
        return {
            success: false,
            error: `Tool not found: ${name}`,
        };
    }
    return tool.execute(params ?? {});
}
function getToolDefinitionsForAI() {
    return (0, kernel_tool_plane_1.getAIKernelToolDefinitions)().map((tool) => ({
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
