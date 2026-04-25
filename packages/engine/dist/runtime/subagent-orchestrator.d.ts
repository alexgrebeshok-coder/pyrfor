/**
 * subagent-orchestrator.ts — Pyrfor Phase E: hierarchical SubagentOrchestrator.
 *
 * Spawns child tasks (subagents) with isolated tool subsets, per-agent budgets
 * (tokens, iterations, wall-clock ms), and AbortController propagation.
 * Supports parallel and serial dispatch with a concurrency semaphore.
 */
export interface SubagentToolDef {
    name: string;
    call: (args: any, signal: AbortSignal) => Promise<any>;
}
export interface SubagentSpec {
    id?: string;
    role: string;
    goal: string;
    tools?: SubagentToolDef[];
    maxIterations?: number;
    maxTokens?: number;
    maxDurationMs?: number;
    parentId?: string;
    metadata?: Record<string, unknown>;
}
export interface SubagentRunResult {
    id: string;
    role: string;
    ok: boolean;
    output?: string;
    toolCalls: number;
    iterations: number;
    durationMs: number;
    tokensUsed: number;
    costUsd?: number;
    error?: string;
    cancelled?: boolean;
}
export type SubagentRunner = (spec: SubagentSpec, ctx: {
    signal: AbortSignal;
    logger: (lvl: string, msg: string, m?: any) => void;
}) => Promise<{
    output: string;
    toolCalls: number;
    iterations: number;
    tokensUsed: number;
    costUsd?: number;
}>;
export interface SubagentOrchestratorOptions {
    runner: SubagentRunner;
    cost?: {
        record(input: {
            agentId: string;
            role: string;
            tokens: number;
            usd?: number;
        }): void;
    };
    concurrencyLimit?: number;
    defaultMaxIterations?: number;
    defaultMaxTokens?: number;
    defaultMaxDurationMs?: number;
    clock?: () => number;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}
export interface SubagentOrchestrator {
    spawn(spec: SubagentSpec): Promise<SubagentRunResult>;
    spawnMany(specs: SubagentSpec[], opts?: {
        mode?: 'parallel' | 'serial';
    }): Promise<SubagentRunResult[]>;
    cancel(id: string): boolean;
    cancelAll(): number;
    active(): Array<{
        id: string;
        role: string;
        startedAt: number;
    }>;
    shutdown(): Promise<void>;
}
export declare function createSubagentOrchestrator(opts: SubagentOrchestratorOptions): SubagentOrchestrator;
//# sourceMappingURL=subagent-orchestrator.d.ts.map