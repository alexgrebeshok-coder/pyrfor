export declare function getOrchestrationOpsSnapshot(workspaceId: string, limit?: number): Promise<{
    summary: {
        activeAgentRuns: number;
        openDeadLetters: number;
        openCircuits: number;
        pendingWorkflowApprovals: number;
        activeWorkflowRuns: number;
        failedWorkflowRuns: number;
        succeededWorkflowRuns: number;
    };
    workflowCounts: Record<string, number>;
    recentWorkflowRuns: {
        inputJson: {
            [x: string]: unknown;
        };
        contextJson: {
            [x: string]: unknown;
        };
        resultJson: {
            [x: string]: unknown;
        };
        summary: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
        steps: {
            status: string;
        }[];
        template: {
            name: string;
            id: string;
            status: string;
            version: number;
        };
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        workspaceId: string;
        startedAt: Date | null;
        errorMessage: string | null;
        finishedAt: Date | null;
        workflowTemplateId: string;
        triggerType: string;
        createdBy: string | null;
    }[];
    circuitAgents: {
        name: string;
        id: string;
        status: string;
        role: string;
        runtimeState: {
            lastError: string | null;
            consecutiveFailures: number;
            circuitState: string;
            circuitOpenUntil: Date | null;
        } | null;
    }[];
    workflowApprovals: {
        metadata: Record<string, unknown>;
        id: string;
        createdAt: Date;
        title: string;
        entityId: string | null;
    }[];
    deadLetters: ({
        agent: {
            name: string;
            id: string;
            role: string;
        };
    } & {
        id: string;
        createdAt: Date;
        status: string;
        workspaceId: string;
        agentId: string;
        errorMessage: string;
        runId: string | null;
        reason: string;
        attempts: number;
        resolvedAt: Date | null;
        wakeupRequestId: string | null;
        errorType: string;
        payloadJson: string;
    })[];
}>;
//# sourceMappingURL=ops-service.d.ts.map