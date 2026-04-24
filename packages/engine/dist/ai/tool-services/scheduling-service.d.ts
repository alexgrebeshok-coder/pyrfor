import type { AIToolResult } from '../tools';
export declare const schedulingToolService: {
    getCriticalPath(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    getResourceLoad(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
};
//# sourceMappingURL=scheduling-service.d.ts.map