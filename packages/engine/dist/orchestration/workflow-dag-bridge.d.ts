import { DurableDag, type DagNodeStatus, type DagProvenanceLink } from '../runtime/durable-dag';
export type WorkflowStepSnapshotStatus = 'pending' | 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export interface WorkflowStepSnapshot {
    id: string;
    workflowRunId: string;
    nodeId: string;
    name?: string | null;
    stepType: string;
    status: WorkflowStepSnapshotStatus | string;
    dependsOnJson?: string | null;
    attemptCount?: number | null;
    maxRetries?: number | null;
    heartbeatRunId?: string | null;
    checkpointId?: string | null;
    outputJson?: string | null;
    errorMessage?: string | null;
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
}
export interface WorkflowHeartbeatRunSnapshot {
    id: string;
    status: string;
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
    resultJson?: string | null;
    checkpoints?: Array<{
        id: string;
    }>;
}
export interface BuildWorkflowDagInput {
    workflowRunId: string;
    steps: WorkflowStepSnapshot[];
    dag?: DurableDag;
}
export declare function buildWorkflowDag(input: BuildWorkflowDagInput): DurableDag;
export declare function listReadyWorkflowSteps(dag: DurableDag, steps: WorkflowStepSnapshot[]): WorkflowStepSnapshot[];
export declare function provenanceFromHeartbeatRun(heartbeatRun: WorkflowHeartbeatRunSnapshot): DagProvenanceLink[];
export declare function hydrateStepIntoDag(dag: DurableDag, step: WorkflowStepSnapshot, heartbeatRun?: WorkflowHeartbeatRunSnapshot): import("../runtime").DagNode;
export declare function mapWorkflowStepStatusToDagStatus(status: WorkflowStepSnapshotStatus | string): DagNodeStatus;
//# sourceMappingURL=workflow-dag-bridge.d.ts.map