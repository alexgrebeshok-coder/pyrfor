import type { JSONSchema, ToolResult } from "./types";

const TOOL_RESULT_SUMMARY_MAX_CHARS = 2200;

function isValueCompatible(value: unknown, expectedType: string): boolean {
  if (expectedType === "string") {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  if (expectedType === "number") {
    if (typeof value === "number") {
      return true;
    }
    if (typeof value === "string") {
      return value.trim().length > 0 && !Number.isNaN(Number(value));
    }
    return false;
  }

  if (expectedType === "boolean") {
    return (
      typeof value === "boolean" ||
      value === "true" ||
      value === "false"
    );
  }

  if (expectedType === "array") {
    return Array.isArray(value);
  }

  if (expectedType === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  return true;
}

function formatEnum(enumValues: string[]): string {
  return enumValues.join(", ");
}

export function validateToolParameters(
  schema: JSONSchema,
  params: Record<string, unknown>
 ): string | null {
  if (schema.type !== "object") {
    return "Invalid tool schema definition";
  }

  if (typeof params !== "object" || params === null) {
    return "Tool parameters must be an object";
  }

  const requiredKeys = schema.required ?? [];
  for (const key of requiredKeys) {
    const value = params[key];
    if (value === undefined || value === null) {
      return `Missing required parameter: ${key}`;
    }
    if (typeof value === "string" && value.trim() === "") {
      return `Parameter '${key}' cannot be empty`;
    }
  }

  const shape = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(shape)) {
    if (!(key in params)) {
      continue;
    }

    const value = params[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (propertySchema.type && !isValueCompatible(value, propertySchema.type)) {
      return `Parameter '${key}' must be ${propertySchema.type}`;
    }

    if (
      propertySchema.enum &&
      !propertySchema.enum.includes(String(value))
    ) {
      return `Parameter '${key}' must be one of: ${formatEnum(
        propertySchema.enum
      )}`;
    }
  }

  return null;
}

export function formatToolResultForContext(result: ToolResult): string {
  try {
    const json = JSON.stringify(result, null, 2);
    if (json.length <= TOOL_RESULT_SUMMARY_MAX_CHARS) {
      return json;
    }
    return `${json.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS)}\n... (truncated)`;
  } catch (error) {
    return `Unable to render tool result: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}
