import { randomUUID } from "node:crypto";

import { executeToolCall } from "@/lib/ai/tool-executor";
import {
  ensureBuiltinPluginsRegistered,
  getPlugin,
  getRegisteredPlugins,
} from "@/lib/ai/plugin-system";
import {
  AI_TOOLS,
  type AIToolCall,
  type AIToolDefinition,
  type AIToolName,
  type AIToolResult,
} from "@/lib/ai/tools";
import type { JSONSchema } from "@/lib/ai/tools/types";
import { validateToolParameters } from "@/lib/ai/tools/validation";

type ToolParameterSchema = JSONSchema & Record<string, unknown>;

export type AIKernelToolDomain = "project" | "finance" | "inventory" | "scheduling";
export type AIKernelToolMode = "query" | "mutation";

export interface AIKernelToolDescriptor {
  type: "function";
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  domain: AIKernelToolDomain;
  mode: AIKernelToolMode;
  source: "kernel-tool-plane" | "plugin-system";
}

export interface AIKernelToolExecutionInput {
  toolName: unknown;
  arguments?: unknown;
  toolCallId?: string;
}

type AIKernelToolValidationResult =
  | {
      ok: true;
      descriptor: AIKernelToolDescriptor;
      arguments: Record<string, unknown>;
    }
  | {
      ok: false;
      code: "TOOL_NAME_REQUIRED" | "UNKNOWN_TOOL" | "INVALID_TOOL_ARGUMENTS";
      message: string;
    };

const AI_KERNEL_TOOL_NAME_SET = new Set(AI_TOOLS.map((tool) => tool.function.name));

const BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS: AIKernelToolDescriptor[] = AI_TOOLS.flatMap((tool) => {
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
      source: "kernel-tool-plane" as const,
    },
  ];
});

const BUILTIN_AI_KERNEL_TOOL_REGISTRY = new Map<string, AIKernelToolDescriptor>(
  BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS.map((tool) => [tool.name, tool])
);

export function listAIKernelTools(): readonly AIKernelToolDescriptor[] {
  ensureBuiltinPluginsRegistered();
  return [...BUILTIN_AI_KERNEL_TOOL_DESCRIPTORS, ...getPluginToolDescriptors()];
}

export function getAIKernelTool(toolName: string): AIKernelToolDescriptor | null {
  ensureBuiltinPluginsRegistered();
  return BUILTIN_AI_KERNEL_TOOL_REGISTRY.get(toolName) ?? getPluginToolDescriptor(toolName);
}

export function isAIKernelToolName(value: string): value is AIToolName {
  return AI_KERNEL_TOOL_NAME_SET.has(value);
}

export function getAIKernelToolDefinitions(): readonly AIToolDefinition[] {
  return listAIKernelTools().map((tool) => ({
    type: tool.type,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function validateAIKernelToolRequest(
  input: Pick<AIKernelToolExecutionInput, "toolName" | "arguments">
): AIKernelToolValidationResult {
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

  const normalizedArguments =
    input.arguments === undefined || input.arguments === null
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

export async function executeAIKernelToolCall(call: AIToolCall): Promise<AIToolResult> {
  let parsedArguments: unknown;

  try {
    parsedArguments = JSON.parse(call.function.arguments);
  } catch {
    return createToolFailureResult(
      call.id,
      call.function.name,
      "Invalid JSON arguments",
      "❌ Ошибка: некорректные аргументы"
    );
  }

  const validation = validateAIKernelToolRequest({
    toolName: call.function.name,
    arguments: parsedArguments,
  });

  if (!validation.ok) {
    return createToolFailureResult(
      call.id,
      call.function.name,
      validation.message,
      `❌ Ошибка: ${validation.message}`
    );
  }

  return executeToolCall({
    id: call.id,
    type: "function",
    function: {
      name: validation.descriptor.name as AIToolName,
      arguments: JSON.stringify(validation.arguments),
    },
  });
}

export async function executeAIKernelToolCalls(calls: AIToolCall[]): Promise<AIToolResult[]> {
  return Promise.all(calls.map((call) => executeAIKernelToolCall(call)));
}

export async function executeAIKernelTool(
  input: AIKernelToolExecutionInput
): Promise<AIToolResult> {
  const validation = validateAIKernelToolRequest(input);
  const toolCallId = input.toolCallId?.trim() || `tool-${randomUUID()}`;
  const fallbackName = typeof input.toolName === "string" ? input.toolName.trim() : "unknown";

  if (!validation.ok) {
    const toolName = getAIKernelTool(fallbackName)?.name ?? fallbackName;
    return createToolFailureResult(
      toolCallId,
      toolName,
      validation.message,
      `❌ Ошибка: ${validation.message}`
    );
  }

  return executeToolCall({
    id: toolCallId,
    type: "function",
    function: {
      name: validation.descriptor.name as AIToolName,
      arguments: JSON.stringify(validation.arguments),
    },
  });
}

function createToolFailureResult(
  toolCallId: string,
  name: string,
  error: string,
  displayMessage: string
): AIToolResult {
  return {
    toolCallId,
    name: name as AIToolName,
    success: false,
    result: { error },
    displayMessage,
  };
}

function getPluginToolDescriptors(): AIKernelToolDescriptor[] {
  return getRegisteredPlugins()
    .filter((plugin) => plugin.manifest.enabled)
    .map((plugin) => ({
      type: "function" as const,
      name: plugin.manifest.name,
      description: plugin.manifest.description,
      parameters: normalizePluginParameters(plugin.manifest.parameters),
      domain: inferPluginDomain(plugin.manifest.tags ?? []),
      mode: plugin.manifest.safetyLevel === "read" ? "query" : "mutation",
      source: "plugin-system" as const,
    }));
}

function getPluginToolDescriptor(toolName: string): AIKernelToolDescriptor | null {
  const plugin = getPlugin(toolName);
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

function inferPluginDomain(tags: string[]): AIKernelToolDomain {
  if (tags.includes("finance")) return "finance";
  if (tags.includes("inventory")) return "inventory";
  if (tags.includes("schedule") || tags.includes("time")) return "scheduling";
  return "project";
}

function normalizePluginParameters(parameters: Record<string, unknown> | undefined): ToolParameterSchema {
  if (parameters && typeof parameters.type === "string") {
    return toToolParameterSchema(parameters);
  }

  return toToolParameterSchema({
    type: "object",
    properties: parameters ?? {},
    required: [],
  });
}

function toToolParameterSchema(parameters: Record<string, unknown>): ToolParameterSchema {
  if (typeof parameters.type !== "string") {
    throw new Error("AI tool schema must define a string 'type'.");
  }

  return parameters as ToolParameterSchema;
}

function getToolDomain(toolName: AIToolName): AIKernelToolDomain {
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
      const exhaustive: never = toolName;
      throw new Error(`Unsupported AI tool domain mapping: ${String(exhaustive)}`);
    }
  }
}

function getToolMode(toolName: AIToolName): AIKernelToolMode {
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
      const exhaustive: never = toolName;
      throw new Error(`Unsupported AI tool mode mapping: ${String(exhaustive)}`);
    }
  }
}
