/**
 * pyrfor-metrics-dashboard.ts — Aggregate per-task metrics from Pyrfor iteration runs.
 *
 * Surfaces iteration counts, scores, cost, duration, tokens, and validator
 * failure breakdowns to the CEOClaw dashboard layer.
 */
export interface TaskMetrics {
    taskId: string;
    iterations: number;
    bestScore: number;
    finalScore: number;
    totalCostUsd: number;
    totalDurationMs: number;
    totalTokens: {
        input: number;
        output: number;
    };
    filesTouched: string[];
    commandsRun: number;
    failuresByValidator: Record<string, number>;
    startedAt: number;
    endedAt: number;
}
export interface IterationData {
    iter: number;
    envelope: {
        costUsd: number;
        usage: {
            input_tokens: number;
            output_tokens: number;
        };
        filesTouched: string[];
        commandsRun: unknown[];
    };
    score: {
        total: number;
        breakdown: unknown;
    };
    durationMs: number;
    startedAt: number;
    endedAt: number;
    failedValidators?: string[];
}
export interface MetricsSource {
    listIterations(taskId: string): Promise<IterationData[]>;
}
export declare class MetricsDashboard {
    private readonly source;
    constructor(source: MetricsSource);
    computeTaskMetrics(taskId: string): Promise<TaskMetrics>;
    computeBatch(taskIds: string[]): Promise<TaskMetrics[]>;
    toMarkdownTable(metrics: TaskMetrics[]): string;
    toJson(metrics: TaskMetrics[]): string;
}
//# sourceMappingURL=pyrfor-metrics-dashboard.d.ts.map