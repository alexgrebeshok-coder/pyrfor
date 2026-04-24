import type { AgentWakeupRequest, HeartbeatRun } from "@prisma/client";
export interface SchedulerLogger {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}
type WakeupStatus = "queued" | "processing" | "processed" | "failed" | "skipped" | "cancelled";
type QueuedWakeup = AgentWakeupRequest & {
    agent: {
        workspaceId: string;
        status: string;
        runtimeState?: {
            circuitState: string;
            circuitOpenUntil: Date | null;
        } | null;
    };
};
type ScheduledAgent = {
    id: string;
    workspaceId: string;
    runtimeConfig: string;
    slug: string;
    runtimeState?: {
        circuitState: string;
        circuitOpenUntil: Date | null;
    } | null;
};
type HeartbeatRunRecord = Pick<HeartbeatRun, "id">;
export interface HeartbeatSchedulerPrisma {
    agentWakeupRequest: {
        findMany(args: {
            where: Record<string, unknown>;
            include: {
                agent: {
                    select: {
                        workspaceId: true;
                        status: true;
                        runtimeState?: {
                            select: {
                                circuitState: true;
                                circuitOpenUntil: true;
                            };
                        };
                    };
                };
            };
            orderBy: {
                createdAt: "asc" | "desc";
            } | Array<{
                availableAt?: "asc" | "desc";
                createdAt?: "asc" | "desc";
            }>;
            take: number;
        }): Promise<QueuedWakeup[]>;
        update(args: {
            where: {
                id: string;
            };
            data: {
                status?: WakeupStatus;
                processedAt?: Date | null;
                availableAt?: Date;
                lastError?: string;
                lastErrorType?: string;
                retryCount?: number;
                triggerData?: string;
            };
        }): Promise<unknown>;
        findFirst(args: {
            where: Record<string, unknown>;
        }): Promise<unknown>;
        create(args: {
            data: {
                agentId: string;
                reason: string;
                triggerData: string;
                status: WakeupStatus;
                idempotencyKey?: string;
                maxRetries?: number;
            };
        }): Promise<unknown>;
    };
    heartbeatRun: {
        create(args: {
            data: {
                workspaceId: string;
                agentId: string;
                wakeupRequestId: string;
                status: string;
                invocationSource: string;
                contextSnapshot: string;
            };
        }): Promise<HeartbeatRunRecord>;
        update(args: {
            where: {
                id: string;
            };
            data: {
                status?: string;
                finishedAt?: Date;
                resultJson?: string;
            };
        }): Promise<unknown>;
    };
    agent: {
        update(args: {
            where: {
                id: string;
            };
            data: {
                status: string;
            };
        }): Promise<unknown>;
        findMany(args: {
            where: {
                status: {
                    in: string[];
                };
                runtimeConfig: {
                    not: string;
                };
            };
            select: {
                id: true;
                workspaceId: true;
                runtimeConfig: true;
                slug: true;
                runtimeState?: {
                    select: {
                        circuitState: true;
                        circuitOpenUntil: true;
                    };
                };
            };
        }): Promise<ScheduledAgent[]>;
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
}
interface SchedulerDeps {
    prisma: HeartbeatSchedulerPrisma;
    fetchImpl?: typeof fetch;
    logger?: SchedulerLogger;
    now?: Date;
}
export interface HeartbeatSchedulerConfig {
    batchSize?: number;
    gatewayPort?: number;
    requestTimeoutMs?: number;
    duplicateWindowMs?: number;
}
export interface QueueProcessingResult {
    queued: number;
    processed: number;
    failed: number;
    skipped: number;
}
export interface ScheduleEnqueueResult {
    checked: number;
    enqueued: number;
}
export interface HeartbeatSchedulerResult extends QueueProcessingResult, ScheduleEnqueueResult {
}
export declare function processHeartbeatQueue(deps: SchedulerDeps, config?: HeartbeatSchedulerConfig): Promise<QueueProcessingResult>;
export declare function enqueueScheduledHeartbeatWakeups(deps: SchedulerDeps, config?: HeartbeatSchedulerConfig): Promise<ScheduleEnqueueResult>;
export declare function runHeartbeatScheduler(deps: SchedulerDeps, config?: HeartbeatSchedulerConfig): Promise<HeartbeatSchedulerResult>;
export declare function cronMatchesNow(expression: string, now?: Date): boolean;
export {};
//# sourceMappingURL=heartbeat-scheduler.d.ts.map