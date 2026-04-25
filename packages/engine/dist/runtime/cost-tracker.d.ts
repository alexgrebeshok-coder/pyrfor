/**
 * cost-tracker.ts — Per-model token usage and dollar cost tracker for the Pyrfor engine.
 *
 * Features:
 * - Per-model pricing configuration
 * - Time-windowed spend queries (hour/day/month/total)
 * - Budget alerts with deduplication per window epoch
 * - Atomic file persistence (tmp + rename)
 * - Injectable clock for deterministic testing
 */
export interface ModelPricing {
    promptPer1k: number;
    completionPer1k: number;
}
export interface UsageRecord {
    ts: number;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    meta?: Record<string, unknown>;
}
export interface BudgetAlert {
    id: string;
    level: 'warn' | 'critical';
    threshold: number;
    window: 'hour' | 'day' | 'month' | 'total';
}
export interface CostTrackerOptions {
    pricing?: Record<string, ModelPricing>;
    persistPath?: string;
    clock?: () => number;
    onAlert?: (alert: BudgetAlert, currentSpend: number) => void;
}
export interface CostTracker {
    record(model: string, prompt: number, completion: number, meta?: Record<string, unknown>): UsageRecord;
    setPricing(model: string, pricing: ModelPricing): void;
    addAlert(alert: BudgetAlert): void;
    removeAlert(id: string): boolean;
    getSpend(window: BudgetAlert['window'], model?: string): number;
    getTokens(window: BudgetAlert['window'], model?: string): {
        prompt: number;
        completion: number;
        total: number;
    };
    getStats(): {
        totalCost: number;
        totalTokens: number;
        perModel: Record<string, {
            cost: number;
            prompt: number;
            completion: number;
            calls: number;
        }>;
    };
    getRecent(limit?: number): UsageRecord[];
    clear(): void;
    save(): void;
    load(): void;
}
export declare function createCostTracker(opts?: CostTrackerOptions): CostTracker;
//# sourceMappingURL=cost-tracker.d.ts.map