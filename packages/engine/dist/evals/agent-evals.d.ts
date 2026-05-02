/**
 * agent-evals.ts — Sprint 4 eval module: agent task evals.
 *
 * Scores how well an agent run (a stream of LedgerEvents produced by the
 * EventLedger contract) satisfies a task's success criteria. This module is
 * purely evaluative — it never drives the agent. The caller supplies an
 * AgentRunner that executes the agent and returns the resulting events plus
 * timing information.
 *
 * @module agent-evals
 */
import type { LedgerEvent } from '../runtime/event-ledger.js';
export type CriterionKind = 'tool_called' | 'tool_not_called' | 'final_text_includes' | 'final_text_matches' | 'completed_within_ms' | 'no_errors' | 'event_count_at_most';
export interface Criterion {
    kind: CriterionKind;
    params: Record<string, unknown>;
    /** Contribution to maxScore / totalScore. Defaults to 1. */
    weight?: number;
    description?: string;
}
export interface AgentEvalTask {
    id: string;
    prompt: string;
    criteria: Criterion[];
    /** Milliseconds before the runner is aborted. Defaults to 60 000. */
    timeoutMs?: number;
}
export interface AgentRunResult {
    events: LedgerEvent[];
    finalText?: string;
    durationMs: number;
}
export type AgentRunner = (task: AgentEvalTask, opts: {
    signal: AbortSignal;
}) => Promise<AgentRunResult>;
export interface CriterionScore {
    criterion: Criterion;
    passed: boolean;
    /** Actual score earned: weight when passed, 0 when failed. */
    score: number;
    reason: string;
}
export interface TaskScore {
    taskId: string;
    /** Sum of weights actually earned across all criteria. */
    totalScore: number;
    /** Sum of all criterion weights (maximum achievable). */
    maxScore: number;
    /** totalScore / maxScore, clamped 0–1. */
    ratio: number;
    /** true iff ratio === 1 (all criteria passed at full weight). */
    passed: boolean;
    durationMs: number;
    criterionScores: CriterionScore[];
    /** Set when the runner threw or was aborted. */
    error?: string;
}
export interface EvalReport {
    totalTasks: number;
    passedTasks: number;
    averageRatio: number;
    /** ISO 8601 timestamp of when runAgentEvals was invoked. */
    startedAt: string;
    /** ISO 8601 timestamp of when runAgentEvals returned. */
    finishedAt: string;
    scores: TaskScore[];
}
export interface RunEvalsOptions {
    tasks: AgentEvalTask[];
    runner: AgentRunner;
    /** Called after each task completes (pass or fail). */
    onTask?: (s: TaskScore) => void;
}
/**
 * Score a single criterion against a completed agent run result.
 *
 * Pure function — no side effects, no I/O.
 * Unknown criterion kinds produce passed=false with an explanatory reason.
 */
export declare function scoreCriterion(c: Criterion, run: AgentRunResult): CriterionScore;
/**
 * Run each eval task sequentially, score criteria, and return a full report.
 *
 * Each task gets its own AbortController wired to `task.timeoutMs` (default
 * 60 000 ms). If the runner throws or is aborted, TaskScore.error is set and
 * all criterion scores are 0.
 */
export declare function runAgentEvals(opts: RunEvalsOptions): Promise<EvalReport>;
/**
 * Load and parse an AgentEvalTask[] from a JSON file on disk.
 * Throws if the file is missing or contains invalid JSON.
 */
export declare function loadTasksFromFile(filePath: string): Promise<AgentEvalTask[]>;
//# sourceMappingURL=agent-evals.d.ts.map