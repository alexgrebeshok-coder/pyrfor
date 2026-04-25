/**
 * pyrfor-cost-aggregate.ts — Task-level cost aggregation for FC sessions.
 *
 * A Pyrfor task (e.g., one user request) spawns N FC sessions (Ralph loop, Best-of-N, Plan/Act).
 * This module tracks per-session cost and provides task-level totals.
 */
import type { FCEnvelope } from './pyrfor-fc-adapter';
import type { CostTracker } from './cost-tracker';
export interface FcSessionCost {
    sessionId?: string | null;
    model?: string;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    durationMs?: number;
    filesTouched: number;
    commandsRun: number;
    status: string;
    startedAt: number;
    finishedAt: number;
}
export interface TaskCostSummary {
    taskId: string;
    startedAt: number;
    finishedAt?: number;
    sessions: FcSessionCost[];
    totals: {
        sessions: number;
        costUsd: number;
        promptTokens: number;
        completionTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        filesTouched: number;
        commandsRun: number;
        durationMs: number;
    };
    byModel: Record<string, {
        costUsd: number;
        promptTokens: number;
        completionTokens: number;
        sessions: number;
    }>;
}
export interface CostAggregatorOptions {
    /** Optional persistent cost tracker — if provided, every FC envelope is also recorded into it via .record(). */
    costTracker?: CostTracker;
    /** Clock for tests */
    now?: () => number;
}
export interface CostAggregator {
    /** Start tracking a new task. Returns taskId (auto-generated if not provided). */
    startTask(taskId?: string): string;
    /** Record a completed FC run for a task. Returns the FcSessionCost row. */
    recordFcRun(taskId: string, envelope: FCEnvelope): FcSessionCost;
    /** Mark task done; returns final summary. */
    finishTask(taskId: string): TaskCostSummary;
    /** Get current summary without finishing. */
    getSummary(taskId: string): TaskCostSummary | null;
    /** List all known task summaries (current state). */
    listTasks(): TaskCostSummary[];
}
/**
 * Stateless helper: extract per-session cost from an envelope.
 */
export declare function envelopeToSessionCost(env: FCEnvelope, now?: () => number): FcSessionCost;
export declare function createCostAggregator(opts?: CostAggregatorOptions): CostAggregator;
//# sourceMappingURL=pyrfor-cost-aggregate.d.ts.map