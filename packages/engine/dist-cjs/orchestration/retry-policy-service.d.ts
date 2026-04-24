import type { AgentRuntimeConfig, WakeupReason } from "./types";
export type OrchestrationErrorType = "timeout" | "network" | "adapter_unavailable" | "circuit_open" | "rate_limit" | "budget_exceeded" | "permission_denied" | "validation" | "cancelled" | "execution_failed" | "unknown";
export interface FailureClassification {
    errorType: OrchestrationErrorType;
    message: string;
    retryable: boolean;
}
export interface RetryDecision {
    kind: "requeue" | "dead_letter";
    classification: FailureClassification;
    retryCount: number;
    maxRetries: number;
    nextRetryAt?: Date;
}
type WakeupRecord = {
    id: string;
    agentId: string;
    reason: string;
    triggerData: string;
    retryCount: number;
    maxRetries: number;
    idempotencyKey: string | null;
};
type RetryPrisma = {
    agentWakeupRequest: {
        update(args: {
            where: {
                id: string;
            };
            data: {
                status?: string;
                retryCount?: number;
                availableAt?: Date;
                lastError?: string;
                lastErrorType?: string;
                processedAt?: Date | null;
            };
        }): Promise<unknown>;
    };
    deadLetterJob: {
        create(args: {
            data: {
                workspaceId: string;
                agentId: string;
                wakeupRequestId?: string;
                runId?: string;
                reason: string;
                errorType: string;
                errorMessage: string;
                payloadJson: string;
                attempts: number;
                status: string;
            };
        }): Promise<unknown>;
    };
};
export declare function buildWakeupIdempotencyKey(input: {
    agentId: string;
    reason: WakeupReason;
    triggerData?: Record<string, unknown>;
    scope?: string;
    now?: Date;
    bucketMs?: number;
}): string;
export declare function resolveMaxRetries(runtimeConfig?: AgentRuntimeConfig | string | null, fallback?: number): number;
export declare function computeRetryDelayMs(retryCount: number, runtimeConfig?: AgentRuntimeConfig | string | null): number;
export declare function classifyOrchestrationFailure(error: unknown): FailureClassification;
export declare function applyWakeupFailure(input: {
    wakeupRequest: WakeupRecord;
    workspaceId: string;
    runId?: string;
    runtimeConfig?: AgentRuntimeConfig | string | null;
    error: unknown;
    prismaClient?: RetryPrisma;
}): Promise<RetryDecision>;
export {};
//# sourceMappingURL=retry-policy-service.d.ts.map