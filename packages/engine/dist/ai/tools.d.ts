/**
 * AI Tool Definitions — OpenAI function calling format
 *
 * These tools enable the AI to directly create/modify resources
 * in the CEOClaw database through structured function calls.
 */
export interface AIToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
export declare const AI_TOOLS: AIToolDefinition[];
export type AIToolName = "create_task" | "create_risk" | "update_task" | "get_project_summary" | "list_tasks" | "generate_brief" | "create_expense" | "get_budget_summary" | "list_equipment" | "create_material_movement" | "get_critical_path" | "get_resource_load" | "sync_1c";
export interface AIToolCall {
    id: string;
    type: "function";
    function: {
        name: AIToolName;
        arguments: string;
    };
}
export interface AIToolResult {
    toolCallId: string;
    name: AIToolName;
    success: boolean;
    result: Record<string, unknown>;
    displayMessage: string;
}
//# sourceMappingURL=tools.d.ts.map