import type { AIChatContextBundle, AIChatContextInput, AIChatMessage } from './context-builder';
import { type KernelChatContextResult } from './kernel-context-stack';
import { type AIKernelToolDescriptor } from './kernel-tool-plane';
import { type ServerAIStatus } from './server-runs';
import type { AIToolResult } from './tools';
import type { AIApplyProposalInput, AIRunInput, AIRunRecord } from './types';
export declare const AI_KERNEL_OPERATIONS: readonly ["status", "run.create", "run.get", "run.list", "run.apply", "chat.context.build", "tool.list", "tool.execute"];
export type AIKernelOperation = (typeof AI_KERNEL_OPERATIONS)[number];
export interface AIKernelActorContext {
    userId?: string;
    role?: string;
    workspaceId?: string;
    organizationSlug?: string | null;
}
export interface AIKernelExecutionContext {
    correlationId?: string;
    transport?: "http" | "internal";
    path?: string;
    actor?: AIKernelActorContext;
}
export interface AIKernelRunLookupInput {
    runId: string;
}
export interface AIKernelChatContextBuildInput extends AIChatContextInput {
    includeMessages?: boolean;
}
export interface AIKernelToolExecuteInput {
    toolName: unknown;
    arguments?: unknown;
}
export type AIKernelRequest = {
    operation: "status";
} | {
    operation: "run.create";
    payload: AIRunInput;
} | {
    operation: "run.get";
    payload: AIKernelRunLookupInput;
} | {
    operation: "run.list";
} | {
    operation: "run.apply";
    payload: AIApplyProposalInput;
} | {
    operation: "chat.context.build";
    payload: AIKernelChatContextBuildInput;
} | {
    operation: "tool.list";
} | {
    operation: "tool.execute";
    payload: AIKernelToolExecuteInput;
};
export type AIKernelOperationDataMap = {
    status: {
        status: ServerAIStatus;
        supportedOperations: readonly AIKernelOperation[];
    };
    "run.create": {
        run: AIRunRecord;
    };
    "run.get": {
        run: AIRunRecord;
    };
    "run.list": {
        runs: AIRunRecord[];
        count: number;
    };
    "run.apply": {
        run: AIRunRecord;
    };
    "chat.context.build": {
        bundle: AIChatContextBundle;
        messages?: AIChatMessage[];
        assembly: KernelChatContextResult["assembly"];
    };
    "tool.list": {
        tools: readonly AIKernelToolDescriptor[];
        count: number;
    };
    "tool.execute": {
        result: AIToolResult;
    };
};
export interface AIKernelError {
    code: string;
    message: string;
    status: number;
    details?: unknown;
}
export type AIKernelSuccessResponse<Operation extends AIKernelOperation = AIKernelOperation> = {
    success: true;
    operation: Operation;
    correlationId: string;
    timestamp: string;
    data: AIKernelOperationDataMap[Operation];
};
export type AIKernelFailureResponse<Operation extends AIKernelOperation = AIKernelOperation> = {
    success: false;
    operation: Operation;
    correlationId: string;
    timestamp: string;
    error: AIKernelError;
};
export type AIKernelResponse<Operation extends AIKernelOperation = AIKernelOperation> = AIKernelSuccessResponse<Operation> | AIKernelFailureResponse<Operation>;
export declare function isAIKernelOperation(value: unknown): value is AIKernelOperation;
export declare class AIKernelControlPlane {
    execute<Operation extends AIKernelOperation>(request: Extract<AIKernelRequest, {
        operation: Operation;
    }>, context?: AIKernelExecutionContext): Promise<AIKernelResponse<Operation>>;
    private validate;
    private dispatch;
    private validateRunCreate;
    private validateRunLookup;
    private validateRunApply;
    private validateChatContextRequest;
    private validateToolExecuteRequest;
}
export declare const aiKernelControlPlane: AIKernelControlPlane;
//# sourceMappingURL=kernel-control-plane.d.ts.map