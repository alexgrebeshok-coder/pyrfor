import { type AIToolCall, type AIToolDefinition, type AIToolName, type AIToolResult } from './tools';
import type { JSONSchema } from './tools/types';
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
type AIKernelToolValidationResult = {
    ok: true;
    descriptor: AIKernelToolDescriptor;
    arguments: Record<string, unknown>;
} | {
    ok: false;
    code: "TOOL_NAME_REQUIRED" | "UNKNOWN_TOOL" | "INVALID_TOOL_ARGUMENTS";
    message: string;
};
export declare function listAIKernelTools(): readonly AIKernelToolDescriptor[];
export declare function getAIKernelTool(toolName: string): AIKernelToolDescriptor | null;
export declare function isAIKernelToolName(value: string): value is AIToolName;
export declare function getAIKernelToolDefinitions(): readonly AIToolDefinition[];
export declare function validateAIKernelToolRequest(input: Pick<AIKernelToolExecutionInput, "toolName" | "arguments">): AIKernelToolValidationResult;
export declare function executeAIKernelToolCall(call: AIToolCall): Promise<AIToolResult>;
export declare function executeAIKernelToolCalls(calls: AIToolCall[]): Promise<AIToolResult[]>;
export declare function executeAIKernelTool(input: AIKernelToolExecutionInput): Promise<AIToolResult>;
export {};
//# sourceMappingURL=kernel-tool-plane.d.ts.map