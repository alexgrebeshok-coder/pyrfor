/**
 * Heartbeat Executor — bridges HeartbeatRun → existing agent execution engine
 *
 * Flow:
 * 1. Dequeue AgentWakeupRequest (or accept direct trigger)
 * 2. Create or attach to a HeartbeatRun record (status: queued → running)
 * 3. Resolve agent definition → build system prompt
 * 4. Execute via `runAgentExecution` kernel (tool calls, cost tracking,
 *    circuit breakers, workspace attribution) with an in-file retry /
 *    fallback / timeout shim. Wave F migrated this away from the
 *    deprecated `ImprovedAgentExecutor`.
 * 5. Record events, update HeartbeatRun (succeeded/failed), update RuntimeState
 * 6. Track cost via existing AIRunCost
 * 7. Broadcast SSE events for live UI updates
 */
import type { RunStatus } from "./types";
export interface HeartbeatRunInput {
    runId?: string;
    agentId: string;
    workspaceId: string;
    wakeupRequestId?: string;
    invocationSource?: string;
    task?: string;
    contextSnapshot?: Record<string, unknown>;
}
export interface HeartbeatRunResult {
    runId: string;
    status: RunStatus;
    durationMs: number;
    content?: string;
    error?: string;
    tokens?: number;
    costUsd?: number;
    nextRetryAt?: string;
    deadLettered?: boolean;
}
export declare function checkBudget(agentId: string): Promise<{
    ok: boolean;
    spent: number;
    budget: number;
}>;
export declare function executeHeartbeatRun(input: HeartbeatRunInput): Promise<HeartbeatRunResult>;
export declare function processWakeupQueue(limit?: number): Promise<number>;
//# sourceMappingURL=heartbeat-executor.d.ts.map