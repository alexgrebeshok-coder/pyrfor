import type { AIToolResult } from '../tools';
export declare const inventoryToolService: {
    listEquipment(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
    createMaterialMovement(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult>;
};
//# sourceMappingURL=inventory-service.d.ts.map