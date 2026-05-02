import type { WorkflowRunStatus, WorkflowTemplateStatus } from "./types";
type JsonRecord = Record<string, unknown>;
export interface WorkflowAgentNodeDefinition {
    id: string;
    name: string;
    kind: "agent";
    agentId: string;
    dependsOn?: string[];
    taskTemplate: string;
    maxRetries?: number;
}
export interface WorkflowApprovalNodeDefinition {
    id: string;
    name: string;
    kind: "approval";
    dependsOn?: string[];
    approval: {
        title: string;
        description?: string;
        expiresInHours?: number;
        type?: string;
    };
}
export type WorkflowNodeDefinition = WorkflowAgentNodeDefinition | WorkflowApprovalNodeDefinition;
export interface WorkflowTemplateDefinition {
    version?: number;
    outputNodes?: string[];
    nodes: WorkflowNodeDefinition[];
}
export interface CreateWorkflowTemplateInput {
    workspaceId: string;
    name: string;
    slug?: string;
    description?: string | null;
    status?: WorkflowTemplateStatus;
    definition: string | WorkflowTemplateDefinition;
    createdBy?: string | null;
}
export interface UpdateWorkflowTemplateInput {
    name?: string;
    slug?: string;
    description?: string | null;
    status?: WorkflowTemplateStatus;
    definition?: string | WorkflowTemplateDefinition;
}
export interface CreateWorkflowRunInput {
    workspaceId: string;
    templateId: string;
    input?: string | JsonRecord;
    context?: JsonRecord;
    triggerType?: string;
    createdBy?: string | null;
}
export declare function listWorkflowTemplates(workspaceId: string, status?: WorkflowTemplateStatus): Promise<{
    definitionJson: WorkflowTemplateDefinition;
    recentRunStats: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
    _count: {
        runs: number;
    };
    runs: {
        id: string;
        createdAt: Date;
        status: string;
    }[];
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    description: string | null;
    workspaceId: string;
    version: number;
    slug: string;
    createdBy: string | null;
}[]>;
export declare function createWorkflowTemplate(input: CreateWorkflowTemplateInput): Promise<{
    definitionJson: WorkflowTemplateDefinition;
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    description: string | null;
    workspaceId: string;
    version: number;
    slug: string;
    createdBy: string | null;
}>;
export declare function updateWorkflowTemplate(templateId: string, input: UpdateWorkflowTemplateInput): Promise<{
    definitionJson: WorkflowTemplateDefinition;
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    description: string | null;
    workspaceId: string;
    version: number;
    slug: string;
    createdBy: string | null;
}>;
export declare function getWorkflowTemplate(templateId: string): Promise<{
    definitionJson: WorkflowTemplateDefinition;
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    description: string | null;
    workspaceId: string;
    version: number;
    slug: string;
    createdBy: string | null;
}>;
export declare function createWorkflowRun(input: CreateWorkflowRunInput): Promise<{
    inputJson: JsonRecord;
    contextJson: JsonRecord;
    resultJson: JsonRecord;
    template: {
        definitionJson: WorkflowTemplateDefinition;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        description: string | null;
        workspaceId: string;
        version: number;
        slug: string;
        createdBy: string | null;
    };
    steps: {
        dependsOn: string[];
        inputJson: JsonRecord;
        outputJson: JsonRecord;
        approval: {
            id: string;
            createdAt: Date;
            title: string;
            status: string;
            reviewedAt: Date | null;
            comment: string | null;
        } | null;
        agent: {
            name: string;
            id: string;
            role: string;
            slug: string;
        } | null;
        heartbeatRun: {
            id: string;
            createdAt: Date;
            status: string;
            startedAt: Date | null;
            finishedAt: Date | null;
        } | null;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        startedAt: Date | null;
        agentId: string | null;
        errorMessage: string | null;
        nodeId: string;
        attemptCount: number;
        seq: number;
        finishedAt: Date | null;
        maxRetries: number;
        workflowRunId: string;
        stepType: string;
        heartbeatRunId: string | null;
        checkpointId: string | null;
        dependsOnJson: string;
        approvalId: string | null;
    }[];
    delegations: {
        metadataJson: JsonRecord;
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
        id: string;
        createdAt: Date;
        status: string;
        workspaceId: string;
        reason: string;
        resolvedAt: Date | null;
        workflowStepId: string | null;
        workflowRunId: string | null;
        parentAgentId: string | null;
        childAgentId: string;
        parentRunId: string | null;
        childRunId: string | null;
    }[];
    summary: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
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
}>;
export declare function advanceWorkflowRun(workflowRunId: string): Promise<{
    inputJson: JsonRecord;
    contextJson: JsonRecord;
    resultJson: JsonRecord;
    template: {
        definitionJson: WorkflowTemplateDefinition;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        description: string | null;
        workspaceId: string;
        version: number;
        slug: string;
        createdBy: string | null;
    };
    steps: {
        dependsOn: string[];
        inputJson: JsonRecord;
        outputJson: JsonRecord;
        approval: {
            id: string;
            createdAt: Date;
            title: string;
            status: string;
            reviewedAt: Date | null;
            comment: string | null;
        } | null;
        agent: {
            name: string;
            id: string;
            role: string;
            slug: string;
        } | null;
        heartbeatRun: {
            id: string;
            createdAt: Date;
            status: string;
            startedAt: Date | null;
            finishedAt: Date | null;
        } | null;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        startedAt: Date | null;
        agentId: string | null;
        errorMessage: string | null;
        nodeId: string;
        attemptCount: number;
        seq: number;
        finishedAt: Date | null;
        maxRetries: number;
        workflowRunId: string;
        stepType: string;
        heartbeatRunId: string | null;
        checkpointId: string | null;
        dependsOnJson: string;
        approvalId: string | null;
    }[];
    delegations: {
        metadataJson: JsonRecord;
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
        id: string;
        createdAt: Date;
        status: string;
        workspaceId: string;
        reason: string;
        resolvedAt: Date | null;
        workflowStepId: string | null;
        workflowRunId: string | null;
        parentAgentId: string | null;
        childAgentId: string;
        parentRunId: string | null;
        childRunId: string | null;
    }[];
    summary: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
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
}>;
export declare function listWorkflowRuns(workspaceId: string, options?: {
    status?: WorkflowRunStatus;
    templateId?: string;
    limit?: number;
}): Promise<{
    inputJson: JsonRecord;
    contextJson: JsonRecord;
    resultJson: JsonRecord;
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
}[]>;
export declare function getWorkflowRunDetail(workflowRunId: string): Promise<{
    inputJson: JsonRecord;
    contextJson: JsonRecord;
    resultJson: JsonRecord;
    template: {
        definitionJson: WorkflowTemplateDefinition;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        description: string | null;
        workspaceId: string;
        version: number;
        slug: string;
        createdBy: string | null;
    };
    steps: {
        dependsOn: string[];
        inputJson: JsonRecord;
        outputJson: JsonRecord;
        approval: {
            id: string;
            createdAt: Date;
            title: string;
            status: string;
            reviewedAt: Date | null;
            comment: string | null;
        } | null;
        agent: {
            name: string;
            id: string;
            role: string;
            slug: string;
        } | null;
        heartbeatRun: {
            id: string;
            createdAt: Date;
            status: string;
            startedAt: Date | null;
            finishedAt: Date | null;
        } | null;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        startedAt: Date | null;
        agentId: string | null;
        errorMessage: string | null;
        nodeId: string;
        attemptCount: number;
        seq: number;
        finishedAt: Date | null;
        maxRetries: number;
        workflowRunId: string;
        stepType: string;
        heartbeatRunId: string | null;
        checkpointId: string | null;
        dependsOnJson: string;
        approvalId: string | null;
    }[];
    delegations: {
        metadataJson: JsonRecord;
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
        id: string;
        createdAt: Date;
        status: string;
        workspaceId: string;
        reason: string;
        resolvedAt: Date | null;
        workflowStepId: string | null;
        workflowRunId: string | null;
        parentAgentId: string | null;
        childAgentId: string;
        parentRunId: string | null;
        childRunId: string | null;
    }[];
    summary: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
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
}>;
export declare function syncWorkflowStepFromHeartbeatRun(runId: string): Promise<{
    inputJson: JsonRecord;
    contextJson: JsonRecord;
    resultJson: JsonRecord;
    template: {
        definitionJson: WorkflowTemplateDefinition;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        description: string | null;
        workspaceId: string;
        version: number;
        slug: string;
        createdBy: string | null;
    };
    steps: {
        dependsOn: string[];
        inputJson: JsonRecord;
        outputJson: JsonRecord;
        approval: {
            id: string;
            createdAt: Date;
            title: string;
            status: string;
            reviewedAt: Date | null;
            comment: string | null;
        } | null;
        agent: {
            name: string;
            id: string;
            role: string;
            slug: string;
        } | null;
        heartbeatRun: {
            id: string;
            createdAt: Date;
            status: string;
            startedAt: Date | null;
            finishedAt: Date | null;
        } | null;
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        startedAt: Date | null;
        agentId: string | null;
        errorMessage: string | null;
        nodeId: string;
        attemptCount: number;
        seq: number;
        finishedAt: Date | null;
        maxRetries: number;
        workflowRunId: string;
        stepType: string;
        heartbeatRunId: string | null;
        checkpointId: string | null;
        dependsOnJson: string;
        approvalId: string | null;
    }[];
    delegations: {
        metadataJson: JsonRecord;
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
        id: string;
        createdAt: Date;
        status: string;
        workspaceId: string;
        reason: string;
        resolvedAt: Date | null;
        workflowStepId: string | null;
        workflowRunId: string | null;
        parentAgentId: string | null;
        childAgentId: string;
        parentRunId: string | null;
        childRunId: string | null;
    }[];
    summary: Record<"queued" | "running" | "failed" | "pending" | "cancelled" | "skipped" | "succeeded" | "waiting_approval", number>;
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
} | null>;
export {};
//# sourceMappingURL=workflow-service.d.ts.map