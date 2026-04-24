var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "node:crypto";
import { executeToolCall } from './tool-executor';
import { ensureBuiltinPluginsRegistered, getPlugin, getRegisteredPlugins, } from './plugin-system';
import { AI_TOOLS, } from './tools';
import { validateToolParameters } from './tools/validation';
const AI_KERNEL_TOOL_NAME_SET = new Set(AI_TOOLS.map((tool) => tool.function.name));
const BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS = AI_TOOLS.flatMap((tool) => {
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
export function listAIKernelTools() {
    ensureBuiltinPluginsRegistered();
    return [...BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS, ...getPluginToolDescriptors()];
}
export function getAIKernelTool(toolName) {
    var _a;
    ensureBuiltinPluginsRegistered();
    return (_a = BUILTIN_AI_KERNEL_TOOL_REGISTRY.get(toolName)) !== null && _a !== void 0 ? _a : getPluginToolDescriptor(toolName);
}
export function isAIKernelToolName(value) {
    return AI_KERNEL_TOOL_NAME_SET.has(value);
}
export function getAIKernelToolDefinitions() {
    return listAIKernelTools().map((tool) => ({
        type: tool.type,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
export function validateAIKernelToolRequest(input) {
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
    const validationError = validateToolParameters(descriptor.parameters, normalizedArguments);
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
export function executeAIKernelToolCall(call) {
    return __awaiter(this, void 0, void 0, function* () {
        let parsedArguments;
        try {
            parsedArguments = JSON.parse(call.function.arguments);
        }
        catch (_a) {
            return createToolFailureResult(call.id, call.function.name, "Invalid JSON arguments", "❌ Ошибка: некорректные аргументы");
        }
        const validation = validateAIKernelToolRequest({
            toolName: call.function.name,
            arguments: parsedArguments,
        });
        if (!validation.ok) {
            return createToolFailureResult(call.id, call.function.name, validation.message, `❌ Ошибка: ${validation.message}`);
        }
        return executeToolCall({
            id: call.id,
            type: "function",
            function: {
                name: validation.descriptor.name,
                arguments: JSON.stringify(validation.arguments),
            },
        });
    });
}
export function executeAIKernelToolCalls(calls) {
    return __awaiter(this, void 0, void 0, function* () {
        return Promise.all(calls.map((call) => executeAIKernelToolCall(call)));
    });
}
export function executeAIKernelTool(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const validation = validateAIKernelToolRequest(input);
        const toolCallId = ((_a = input.toolCallId) === null || _a === void 0 ? void 0 : _a.trim()) || `tool-${randomUUID()}`;
        const fallbackName = typeof input.toolName === "string" ? input.toolName.trim() : "unknown";
        if (!validation.ok) {
            const toolName = (_c = (_b = getAIKernelTool(fallbackName)) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : fallbackName;
            return createToolFailureResult(toolCallId, toolName, validation.message, `❌ Ошибка: ${validation.message}`);
        }
        return executeToolCall({
            id: toolCallId,
            type: "function",
            function: {
                name: validation.descriptor.name,
                arguments: JSON.stringify(validation.arguments),
            },
        });
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
    return getRegisteredPlugins()
        .filter((plugin) => plugin.manifest.enabled)
        .map((plugin) => {
        var _a;
        return ({
            type: "function",
            name: plugin.manifest.name,
            description: plugin.manifest.description,
            parameters: normalizePluginParameters(plugin.manifest.parameters),
            domain: inferPluginDomain((_a = plugin.manifest.tags) !== null && _a !== void 0 ? _a : []),
            mode: plugin.manifest.safetyLevel === "read" ? "query" : "mutation",
            source: "plugin-system",
        });
    });
}
function getPluginToolDescriptor(toolName) {
    var _a;
    const plugin = getPlugin(toolName);
    if (!plugin || !plugin.manifest.enabled) {
        return null;
    }
    return {
        type: "function",
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        parameters: normalizePluginParameters(plugin.manifest.parameters),
        domain: inferPluginDomain((_a = plugin.manifest.tags) !== null && _a !== void 0 ? _a : []),
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
        properties: parameters !== null && parameters !== void 0 ? parameters : {},
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
