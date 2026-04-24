import type { AIToolResult } from '../tools';
export declare const financeToolService: {
    createExpense(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    getBudgetSummary(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    syncOneC(toolCallId: string): Promise<AIToolResult>;
};
//# sourceMappingURL=finance-service.d.ts.map