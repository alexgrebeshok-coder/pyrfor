/**
 * AI Run Cost Tracker
 *
 * Estimates and records LLM API call costs.
 * Uses approximate token pricing per provider/model.
 * Records are written asynchronously to avoid blocking.
 */
import "server-only";
/** Prefer js-tiktoken when available, otherwise fall back to a rough char-based estimate. */
export declare function estimateTokens(text: string): number;
export declare function estimateMessagesTokens(messages: Array<{
    content: string;
}>): number;
export interface RunCost {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costRub: number;
}
export declare function calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number): RunCost;
export interface CostRecord extends RunCost {
    agentId?: string;
    sessionId?: string;
    workspaceId?: string;
    runId?: string;
}
/**
 * Log a cost record to the database. Non-blocking — errors are logged, not thrown.
 *
 * Side-effect: after the row is persisted we refresh the workspace's daily
 * posture and, if a budget threshold was just crossed (80% warning or 100%
 * breach), publish a `budget.alert` event on the agent bus exactly once per
 * workspace/day/threshold. Consumers (UI banner, ops dashboard, Slack
 * webhook in a later wave) subscribe to this event.
 */
export declare function trackCost(record: CostRecord): Promise<void>;
export type BudgetAlertSeverity = "warning" | "breach";
export interface BudgetAlertPayload {
    workspaceId: string;
    severity: BudgetAlertSeverity;
    threshold: number;
    totalUsdToday: number;
    dailyLimitUsd: number;
    utilization: number;
    triggeredBy: {
        agentId?: string;
        runId?: string;
        provider: string;
        model: string;
        costUsd: number;
    };
    at: string;
}
/**
 * Fetch recent budget alerts for a workspace from the in-process bus log.
 * Used by the AI Ops dashboard to render a "recent breaches" panel.
 */
export declare function getRecentBudgetAlerts(workspaceId: string, limit?: number): BudgetAlertPayload[];
/**
 * Internal helper — exposed for tests so they can clear state between runs.
 * @internal
 */
export declare function __resetBudgetAlertCacheForTests(): void;
/**
 * Convenience: estimate input tokens from messages, then track after response.
 */
export declare function buildCostRecorder(provider: string, model: string, inputMessages: Array<{
    content: string;
}>, meta?: Omit<CostRecord, "provider" | "model" | "inputTokens" | "outputTokens" | "costUsd" | "costRub">): (responseText: string) => RunCost;
export interface DailyCostPosture {
    workspaceId: string;
    totalUsdToday: number;
    dailyLimitUsd: number;
    utilization: number;
    remainingUsd: number;
    recordCount: number;
    breachedAt?: string | null;
}
/**
 * Snapshot today's AI spend for a workspace against the configured daily
 * budget. Returns a best-effort posture; on database failure returns an
 * "unknown" posture (utilisation 0) so ops endpoints stay up even when the
 * cost store is misbehaving.
 */
export declare function getDailyCostPosture(workspaceId: string): Promise<DailyCostPosture>;
export declare function checkCostBudget(workspaceId: string): Promise<boolean>;
//# sourceMappingURL=cost-tracker.d.ts.map