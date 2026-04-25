/**
 * cost-aware-dag.ts — Pyrfor CostAwareDAGPlanner.
 *
 * Given a task spec and a list of available steps (each with cost estimates +
 * dependencies), produces an execution DAG that minimises expected cost subject
 * to a budget cap, supports critical-path scheduling, and emits a
 * topologically-sorted execution plan ready for SubagentOrchestrator.
 *
 * Pure TS, ESM-only, no native dependencies.
 */
export interface DAGStepSpec {
    id: string;
    name: string;
    role?: string;
    dependsOn?: string[];
    estTokens: number;
    estDurationMs: number;
    estUsd?: number;
    optional?: boolean;
    /** Higher = keep first when dropping for budget. Default 1. */
    priority?: number;
    alternatives?: DAGStepSpec[];
    /** 0..1. Default 1 (certain success). */
    successProb?: number;
}
export interface DAGPlanRequest {
    goal: string;
    steps: DAGStepSpec[];
    budgetUsd?: number;
    budgetTokens?: number;
    budgetDurationMs?: number;
    /** Default 5e-6 USD/token */
    tokenPriceUsd?: number;
    /** Multiply estCost by 1+retryFactor*(1-successProb). Default 1. */
    retryFactor?: number;
    /** If true, optimise for time over cost. */
    preferDuration?: boolean;
}
export interface DAGPlannedStep {
    id: string;
    name: string;
    role?: string;
    dependsOn: string[];
    expectedTokens: number;
    expectedUsd: number;
    expectedDurationMs: number;
    earliestStartMs: number;
    earliestEndMs: number;
    /** Topological layer index (0-based). */
    level: number;
    /** Alternative id if a substitute was chosen. */
    alternativeChosen?: string;
}
export interface DAGPlan {
    goal: string;
    steps: DAGPlannedStep[];
    /** Step ids grouped by topological layer. */
    layers: string[][];
    criticalPath: string[];
    totalExpectedTokens: number;
    totalExpectedUsd: number;
    /** Critical-path duration (longest path end time). */
    totalExpectedDurationMs: number;
    /** Optional steps excluded to satisfy budget. */
    droppedSteps: string[];
    warnings: string[];
    feasible: boolean;
}
export interface CostAwareDAGPlanner {
    plan(req: DAGPlanRequest): DAGPlan;
    toSubagentSpecs(plan: DAGPlan, opts?: {
        goalPrefix?: string;
    }): Array<{
        id: string;
        role: string;
        goal: string;
        dependsOn: string[];
    }>;
}
export interface CreateCostAwareDAGPlannerOptions {
    defaultTokenPriceUsd?: number;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}
export declare function createCostAwareDAGPlanner(plannerOpts?: CreateCostAwareDAGPlannerOptions): CostAwareDAGPlanner;
//# sourceMappingURL=cost-aware-dag.d.ts.map