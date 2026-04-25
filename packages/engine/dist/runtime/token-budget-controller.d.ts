/**
 * Token / Cost Budget Controller
 *
 * Tracks LLM token and USD consumption across task / session / global scopes,
 * enforces configurable per-window limits, emits warnings and block events, and
 * persists state atomically across restarts.
 *
 * No external dependencies — only node:fs/promises and node:path.
 */
export type BudgetScope = 'task' | 'session' | 'global';
export type BudgetWindow = 'hour' | 'day' | 'month' | 'total';
export interface BudgetRule {
    id: string;
    scope: BudgetScope;
    window: BudgetWindow;
    maxTokens?: number;
    maxCostUsd?: number;
    /** Emit a 'warn' event when usage reaches this percentage of the limit (0-100). */
    warnAtPercent?: number;
    /** For scope='task'|'session': restrict to a specific targetId. */
    targetId?: string;
}
export interface Consumption {
    ts: number;
    scope: BudgetScope;
    targetId?: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    provider?: string;
}
export interface ConsumeRequest {
    scope: BudgetScope;
    targetId?: string;
    estPromptTokens: number;
    estCompletionTokens: number;
    estCostUsd: number;
}
export interface CanConsumeResult {
    allowed: boolean;
    blockingRule?: string;
    remainingTokens?: number;
    remainingCostUsd?: number;
}
export interface WindowUsage {
    tokens: number;
    costUsd: number;
    windowStart: number;
    windowEnd: number;
}
export interface RuleSnapshot {
    rule: BudgetRule;
    usage: WindowUsage;
    percentUsed: number;
}
export interface BudgetSnapshot {
    rules: RuleSnapshot[];
    totalConsumption: number;
    totalCostUsd: number;
}
type EventName = 'consume' | 'warn' | 'block';
type EventCallback = (payload: unknown) => void;
type Unsubscribe = () => void;
export interface TokenBudgetController {
    addRule(rule: BudgetRule): void;
    removeRule(id: string): void;
    listRules(): BudgetRule[];
    canConsume(req: ConsumeRequest): CanConsumeResult;
    recordConsumption(c: Consumption): {
        warnings: string[];
    };
    usageFor(rule: BudgetRule): WindowUsage;
    reportSnapshot(): BudgetSnapshot;
    flush(): Promise<void>;
    reset(scope?: BudgetScope): void;
    on(event: EventName, cb: EventCallback): Unsubscribe;
}
export interface TokenBudgetControllerOptions {
    storePath: string;
    rules?: BudgetRule[];
    clock?: () => number;
    flushDebounceMs?: number;
    logger?: (msg: string, meta?: unknown) => void;
}
export declare function createTokenBudgetController(opts: TokenBudgetControllerOptions): TokenBudgetController;
export {};
//# sourceMappingURL=token-budget-controller.d.ts.map