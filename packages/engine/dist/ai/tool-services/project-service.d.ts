import type { AIToolResult } from '../tools';
export declare const projectToolService: {
    createTask(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    createRisk(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    updateTask(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    getProjectSummary(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    listTasks(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    generateBrief(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
};
//# sourceMappingURL=project-service.d.ts.map