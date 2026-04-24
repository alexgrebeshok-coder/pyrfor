import type { WakeupReason } from "./types";
export interface JobPayload {
    agentId: string;
    reason: WakeupReason;
    triggerData?: Record<string, unknown>;
    idempotencyKey?: string;
    maxRetries?: number;
}
export interface Job {
    id: string;
    agentId: string;
    reason: string;
    triggerData: Record<string, unknown>;
    status: string;
    retryCount: number;
    maxRetries: number;
    idempotencyKey: string | null;
    createdAt: Date;
}
export interface IJobQueue {
    enqueue(payload: JobPayload): Promise<Job>;
    dequeueNext(): Promise<Job | null>;
    markDone(jobId: string): Promise<void>;
    markFailed(jobId: string): Promise<void>;
    getPending(agentId?: string): Promise<Job[]>;
}
export declare const jobQueue: IJobQueue;
//# sourceMappingURL=job-queue.d.ts.map