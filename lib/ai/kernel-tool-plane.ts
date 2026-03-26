import { randomUUID } from "node:crypto";

import { executeToolCall } from "@/lib/ai/tool-executor";
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
  name: AIToolName;
  description: string;
  parameters: ToolParameterSchema;
  domain: AIKernelToolDomain;
  mode: AIKernelToolMode;
  source: "kernel-tool-plane";
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

const AI_KERNEL_TOOL_DESCRIPTORS: AIKernelToolDescriptor[] = AI_TOOLS.flatMap((tool) => {
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

const AI_KERNEL_TOOL_DEFINITIONS: AIToolDefinition[] = AI_KERNEL_TOOL_DESCRIPTORS.map((tool) => ({
  type: tool.type,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

const AI_KERNEL_TOOL_REGISTRY = new Map<AIToolName, AIKernelToolDescriptor>(
  AI_KERNEL_TOOL_DESCRIPTORS.map((tool) => [tool.name, tool])
);

export function listAIKernelTools(): readonly AIKernelToolDescriptor[] {
  return AI_KERNEL_TOOL_DESCRIPTORS;
}

export function getAIKernelTool(toolName: string): AIKernelToolDescriptor | null {
  if (!isAIKernelToolName(toolName)) {
    return null;
  }

  return AI_KERNEL_TOOL_REGISTRY.get(toolName) ?? null;
}

export function isAIKernelToolName(value: string): value is AIToolName {
  return AI_KERNEL_TOOL_NAME_SET.has(value);
}

export function getAIKernelToolDefinitions(): readonly AIToolDefinition[] {
  return AI_KERNEL_TOOL_DEFINITIONS;
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
  if (!isAIKernelToolName(normalizedToolName)) {
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

  const descriptor = AI_KERNEL_TOOL_REGISTRY.get(normalizedToolName);
  if (!descriptor) {
    return {
      ok: false,
      code: "UNKNOWN_TOOL",
      message: `Unknown AI tool: ${normalizedToolName}`,
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
      name: validation.descriptor.name,
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
    const toolName = isAIKernelToolName(fallbackName) ? fallbackName : "create_task";
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
      name: validation.descriptor.name,
      arguments: JSON.stringify(validation.arguments),
    },
  });
}

function createToolFailureResult(
  toolCallId: string,
  name: AIToolName,
  error: string,
  displayMessage: string
): AIToolResult {
  return {
    toolCallId,
    name,
    success: false,
    result: { error },
    displayMessage,
  };
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
