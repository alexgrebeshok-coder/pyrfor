"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAIKernelTools = listAIKernelTools;
exports.getAIKernelTool = getAIKernelTool;
exports.isAIKernelToolName = isAIKernelToolName;
exports.getAIKernelToolDefinitions = getAIKernelToolDefinitions;
exports.validateAIKernelToolRequest = validateAIKernelToolRequest;
exports.executeAIKernelToolCall = executeAIKernelToolCall;
exports.executeAIKernelToolCalls = executeAIKernelToolCalls;
exports.executeAIKernelTool = executeAIKernelTool;
const node_crypto_1 = require("node:crypto");
const tool_executor_1 = require("./tool-executor");
const plugin_system_1 = require("./plugin-system");
const tools_1 = require("./tools");
const validation_1 = require("./tools/validation");
const AI_KERNEL_TOOL_NAME_SET = new Set(tools_1.AI_TOOLS.map((tool) => tool.function.name));
const BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS = tools_1.AI_TOOLS.flatMap((tool) => {
    if (!isAIKernelToolName(tool.function.name)) {
        return [];
    }
    return [
        {
            type: tool.type,
            name: tool.function.name,
            description: tool.function.description,
            parameters: toToolParameterSchema(tool.function.parameters),
            domain: getToolDomain(tool.function.name),
            mode: getToolMode(tool.function.name),
            source: "kernel-tool-plane",
        },
    ];
});
const BUILTIN_AI_KERNEL_TOOL_REGISTRY = new Map(BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS.map((tool) => [tool.name, tool]));
function listAIKernelTools() {
    (0, plugin_system_1.ensureBuiltinPluginsRegistered)();
    return [...BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS, ...getPluginToolDescriptors()];
}
function getAIKernelTool(toolName) {
    (0, plugin_system_1.ensureBuiltinPluginsRegistered)();
    return BUILTIN_AI_KERNEL_TOOL_REGISTRY.get(toolName) ?? getPluginToolDescriptor(toolName);
}
function isAIKernelToolName(value) {
    return AI_KERNEL_TOOL_NAME_SET.has(value);
}
function getAIKernelToolDefinitions() {
    return listAIKernelTools().map((tool) => ({
        type: tool.type,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
function validateAIKernelToolRequest(input) {
    if (typeof input.toolName !== "string" || input.toolName.trim().length === 0) {
        return {
            ok: false,
            code: "TOOL_NAME_REQUIRED",
            message: "A valid AI tool name is required.",
        };
    }
    const normalizedToolName = input.toolName.trim();
    const descriptor = getAIKernelTool(normalizedToolName);
    if (!descriptor) {
        return {
            ok: false,
            code: "UNKNOWN_TOOL",
            message: `Unknown AI tool: ${normalizedToolName}`,
        };
    }
    const normalizedArguments = input.arguments === undefined || input.arguments === null
        ? {}
        : typeof input.arguments === "object" && !Array.isArray(input.arguments)
            ? Object.fromEntries(Object.entries(input.arguments))
            : null;
    if (normalizedArguments === null) {
        return {
            ok: false,
            code: "INVALID_TOOL_ARGUMENTS",
            message: "AI tool arguments must be an object.",
        };
    }
    const validationError = (0, validation_1.validateToolParameters)(descriptor.parameters, normalizedArguments);
    if (validationError) {
        return {
            ok: false,
            code: "INVALID_TOOL_ARGUMENTS",
            message: validationError,
        };
    }
    return {
        ok: true,
        descriptor,
        arguments: normalizedArguments,
    };
}
async function executeAIKernelToolCall(call) {
    let parsedArguments;
    try {
        parsedArguments = JSON.parse(call.function.arguments);
    }
    catch {
        return createToolFailureResult(call.id, call.function.name, "Invalid JSON arguments", "❌ Ошибка: некорректные аргументы");
    }
    const validation = validateAIKernelToolRequest({
        toolName: call.function.name,
        arguments: parsedArguments,
    });
    if (!validation.ok) {
        return createToolFailureResult(call.id, call.function.name, validation.message, `❌ Ошибка: ${validation.message}`);
    }
    return (0, tool_executor_1.executeToolCall)({
        id: call.id,
        type: "function",
        function: {
            name: validation.descriptor.name,
            arguments: JSON.stringify(validation.arguments),
        },
    });
}
async function executeAIKernelToolCalls(calls) {
    return Promise.all(calls.map((call) => executeAIKernelToolCall(call)));
}
async function executeAIKernelTool(input) {
    const validation = validateAIKernelToolRequest(input);
    const toolCallId = input.toolCallId?.trim() || `tool-${(0, node_crypto_1.randomUUID)()}`;
    const fallbackName = typeof input.toolName === "string" ? input.toolName.trim() : "unknown";
    if (!validation.ok) {
        const toolName = getAIKernelTool(fallbackName)?.name ?? fallbackName;
        return createToolFailureResult(toolCallId, toolName, validation.message, `❌ Ошибка: ${validation.message}`);
    }
    return (0, tool_executor_1.executeToolCall)({
        id: toolCallId,
        type: "function",
        function: {
            name: validation.descriptor.name,
            arguments: JSON.stringify(validation.arguments),
        },
    });
}
function createToolFailureResult(toolCallId, name, error, displayMessage) {
    return {
        toolCallId,
        name: name,
        success: false,
        result: { error },
        displayMessage,
    };
}
function getPluginToolDescriptors() {
    return (0, plugin_system_1.getRegisteredPlugins)()
        .filter((plugin) => plugin.manifest.enabled)
        .map((plugin) => ({
        type: "function",
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        parameters: normalizePluginParameters(plugin.manifest.parameters),
        domain: inferPluginDomain(plugin.manifest.tags ?? []),
        mode: plugin.manifest.safetyLevel === "read" ? "query" : "mutation",
        source: "plugin-system",
    }));
}
function getPluginToolDescriptor(toolName) {
    const plugin = (0, plugin_system_1.getPlugin)(toolName);
    if (!plugin || !plugin.manifest.enabled) {
        return null;
    }
    return {
        type: "function",
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        parameters: normalizePluginParameters(plugin.manifest.parameters),
        domain: inferPluginDomain(plugin.manifest.tags ?? []),
        mode: plugin.manifest.safetyLevel === "read" ? "query" : "mutation",
        source: "plugin-system",
    };
}
function inferPluginDomain(tags) {
    if (tags.includes("finance"))
        return "finance";
    if (tags.includes("inventory"))
        return "inventory";
    if (tags.includes("schedule") || tags.includes("time"))
        return "scheduling";
    return "project";
}
function normalizePluginParameters(parameters) {
    if (parameters && typeof parameters.type === "string") {
        return toToolParameterSchema(parameters);
    }
    return toToolParameterSchema({
        type: "object",
        properties: parameters ?? {},
        required: [],
    });
}
function toToolParameterSchema(parameters) {
    if (typeof parameters.type !== "string") {
        throw new Error("AI tool schema must define a string 'type'.");
    }
    return parameters;
}
function getToolDomain(toolName) {
    switch (toolName) {
        case "create_task":
        case "create_risk":
        case "update_task":
        case "get_project_summary":
        case "list_tasks":
        case "generate_brief":
            return "project";
        case "create_expense":
        case "get_budget_summary":
        case "sync_1c":
            return "finance";
        case "list_equipment":
        case "create_material_movement":
            return "inventory";
        case "get_critical_path":
        case "get_resource_load":
            return "scheduling";
        default: {
            const exhaustive = toolName;
            throw new Error(`Unsupported AI tool domain mapping: ${String(exhaustive)}`);
        }
    }
}
function getToolMode(toolName) {
    switch (toolName) {
        case "get_project_summary":
        case "list_tasks":
        case "generate_brief":
        case "get_budget_summary":
        case "list_equipment":
        case "get_critical_path":
        case "get_resource_load":
            return "query";
        case "create_task":
        case "create_risk":
        case "update_task":
        case "create_expense":
        case "create_material_movement":
        case "sync_1c":
            return "mutation";
        default: {
            const exhaustive = toolName;
            throw new Error(`Unsupported AI tool mode mapping: ${String(exhaustive)}`);
        }
    }
}
