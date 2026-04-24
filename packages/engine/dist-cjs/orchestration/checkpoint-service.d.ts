export interface CreateHeartbeatCheckpointInput {
    runId: string;
    seq: number;
    stepKey: string;
    checkpointType: string;
    state: Record<string, unknown>;
}
type HeartbeatCheckpointRecord = {
    id: string;
    runId: string;
    seq: number;
    stepKey: string;
    checkpointType: string;
    stateJson: string;
    createdAt: Date;
};
type ReplayableRunRecord = {
    id: string;
    agentId: string;
    workspaceId: string;
    invocationSource: string;
    contextSnapshot: string | null;
    agent: {
        runtimeConfig: string;
    };
    checkpoints: HeartbeatCheckpointRecord[];
};
type CheckpointPrisma = {
    heartbeatRunCheckpoint: {
        create(args: {
            data: {
                runId: string;
                seq: number;
                stepKey: string;
                checkpointType: string;
                stateJson: string;
            };
        }): Promise<HeartbeatCheckpointRecord>;
        findMany(args: {
            where: {
                runId: string;
            };
            orderBy: {
                seq: "asc" | "desc";
            };
        }): Promise<HeartbeatCheckpointRecord[]>;
    };
    heartbeatRun: {
        findUnique(args: {
            where: {
                id: string;
            };
            include: {
                agent: {
                    select: {
                        runtimeConfig: true;
                    };
                };
                checkpoints: {
                    orderBy: {
                        seq: "asc" | "desc";
                    };
                };
            };
        }): Promise<ReplayableRunRecord | null>;
        create(args: {
            data: {
                workspaceId: string;
                agentId: string;
                status: string;
                invocationSource: string;
                contextSnapshot: string;
                replayOfRunId: string;
                replayReason: string;
                replayedFromCheckpointId?: string;
            };
        }): Promise<{
            id: string;
        }>;
    };
    agentWakeupRequest: {
        create(args: {
            data: {
                agentId: string;
                reason: string;
                triggerData: string;
                status: string;
                idempotencyKey: string;
                maxRetries: number;
            };
        }): Promise<unknown>;
    };
};
export declare function parseCheckpointState(checkpoint: Pick<HeartbeatCheckpointRecord, "stateJson">): Record<string, unknown>;
export declare function createHeartbeatRunCheckpoint(input: CreateHeartbeatCheckpointInput, prismaClient?: CheckpointPrisma): Promise<HeartbeatCheckpointRecord>;
export declare function listHeartbeatRunCheckpoints(runId: string, prismaClient?: CheckpointPrisma): Promise<HeartbeatCheckpointRecord[]>;
export declare function queueHeartbeatRunReplay(input: {
    runId: string;
    checkpointId?: string;
    requestedBy?: string;
}, prismaClient?: CheckpointPrisma): Promise<{
    replayRunId: string;
    replayOfRunId: string;
    replayReason: string;
    replayedFromCheckpointId: string | null;
}>;
export {};
//# sourceMappingURL=checkpoint-service.d.ts.map