import type { DelegationStatus } from "./types";
export interface CreateAgentDelegationInput {
    workspaceId: string;
    workflowRunId?: string | null;
    workflowStepId?: string | null;
    parentAgentId?: string | null;
    childAgentId: string;
    parentRunId?: string | null;
    childRunId?: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
}
export declare function createAgentDelegation(input: CreateAgentDelegationInput): Promise<{
    parentAgent: {
        name: string;
        id: string;
        role: string;
    } | null;
    childAgent: {
        name: string;
        id: string;
        role: string;
    };
    parentRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
    childRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
} & {
    id: string;
    createdAt: Date;
    status: string;
    workspaceId: string;
    metadataJson: string;
    reason: string;
    resolvedAt: Date | null;
    workflowStepId: string | null;
    workflowRunId: string | null;
    parentAgentId: string | null;
    childAgentId: string;
    parentRunId: string | null;
    childRunId: string | null;
}>;
export declare function updateDelegationStatusByChildRun(childRunId: string, status: DelegationStatus, metadataPatch?: Record<string, unknown>): Promise<{
    count: number;
}>;
export declare function listRunDelegations(runId: string): Promise<({
    parentAgent: {
        name: string;
        id: string;
        role: string;
    } | null;
    childAgent: {
        name: string;
        id: string;
        role: string;
    };
    parentRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
    childRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
} & {
    id: string;
    createdAt: Date;
    status: string;
    workspaceId: string;
    metadataJson: string;
    reason: string;
    resolvedAt: Date | null;
    workflowStepId: string | null;
    workflowRunId: string | null;
    parentAgentId: string | null;
    childAgentId: string;
    parentRunId: string | null;
    childRunId: string | null;
})[]>;
export declare function listWorkflowDelegations(workflowRunId: string): Promise<({
    parentAgent: {
        name: string;
        id: string;
        role: string;
    } | null;
    childAgent: {
        name: string;
        id: string;
        role: string;
    };
    parentRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
    childRun: {
        id: string;
        createdAt: Date;
        status: string;
    } | null;
} & {
    id: string;
    createdAt: Date;
    status: string;
    workspaceId: string;
    metadataJson: string;
    reason: string;
    resolvedAt: Date | null;
    workflowStepId: string | null;
    workflowRunId: string | null;
    parentAgentId: string | null;
    childAgentId: string;
    parentRunId: string | null;
    childRunId: string | null;
})[]>;
//# sourceMappingURL=delegation-service.d.ts.map