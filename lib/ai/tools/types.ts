/**
 * AI Tool Types
 * Type definitions for AI agent tools
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  minimum?: number;
  maximum?: number;
  format?: string;
}

export interface AITool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolExecutionContext {
  userId?: string;
  organizationId?: string;
  workspaceId?: string;
  locale?: string;
}
