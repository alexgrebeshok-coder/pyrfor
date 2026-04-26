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

import { readFile } from 'node:fs/promises';
import type {
  LedgerEvent,
  ToolExecutedEvent,
  RunFailedEvent,
} from '../runtime/event-ledger.js';

// ===== Criterion kinds =======================================================

export type CriterionKind =
  | 'tool_called' //           params: { tool: string; minTimes?: number }
  | 'tool_not_called' //       params: { tool: string }
  | 'final_text_includes' //   params: { substr: string; caseSensitive?: boolean }
  | 'final_text_matches' //    params: { regex: string; flags?: string }
  | 'completed_within_ms' //   params: { ms: number }
  | 'no_errors' //             params: {}
  | 'event_count_at_most'; //  params: { kind: string; max: number }

// ===== Core interfaces =======================================================

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

export type AgentRunner = (
  task: AgentEvalTask,
  opts: { signal: AbortSignal },
) => Promise<AgentRunResult>;

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

// ===== scoreCriterion (pure) =================================================

/**
 * Score a single criterion against a completed agent run result.
 *
 * Pure function — no side effects, no I/O.
 * Unknown criterion kinds produce passed=false with an explanatory reason.
 */
export function scoreCriterion(c: Criterion, run: AgentRunResult): CriterionScore {
  const weight = c.weight ?? 1;
  // Capture kind as plain string so the default branch can reference it even
  // after TypeScript narrows c.kind to `never` inside the exhaustive switch.
  const kindStr: string = c.kind;

  const pass = (reason: string): CriterionScore => ({
    criterion: c,
    passed: true,
    score: weight,
    reason,
  });

  const fail = (reason: string): CriterionScore => ({
    criterion: c,
    passed: false,
    score: 0,
    reason,
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  const toolExecutedEvents = (): ToolExecutedEvent[] =>
    run.events.filter((e): e is ToolExecutedEvent => e.type === 'tool.executed');

  // ── switch ───────────────────────────────────────────────────────────────

  switch (c.kind) {
    // ── tool_called ──────────────────────────────────────────────────────
    case 'tool_called': {
      const tool = c.params['tool'] as string;
      const minTimes = (c.params['minTimes'] as number | undefined) ?? 1;
      const count = toolExecutedEvents().filter((e) => e.tool === tool).length;
      if (count >= minTimes) {
        return pass(`tool "${tool}" called ${count} time(s); required ≥ ${minTimes}`);
      }
      return fail(`tool "${tool}" called ${count} time(s); required ≥ ${minTimes}`);
    }

    // ── tool_not_called ──────────────────────────────────────────────────
    case 'tool_not_called': {
      const tool = c.params['tool'] as string;
      const count = toolExecutedEvents().filter((e) => e.tool === tool).length;
      if (count === 0) {
        return pass(`tool "${tool}" was not called`);
      }
      return fail(`tool "${tool}" was called ${count} time(s); expected 0`);
    }

    // ── final_text_includes ──────────────────────────────────────────────
    case 'final_text_includes': {
      const substr = c.params['substr'] as string;
      const caseSensitive = (c.params['caseSensitive'] as boolean | undefined) ?? false;
      const text = run.finalText ?? '';
      const haystack = caseSensitive ? text : text.toLowerCase();
      const needle = caseSensitive ? substr : substr.toLowerCase();
      if (haystack.includes(needle)) {
        return pass(`final text includes "${substr}"`);
      }
      return fail(`final text does not include "${substr}"`);
    }

    // ── final_text_matches ───────────────────────────────────────────────
    case 'final_text_matches': {
      const regexStr = c.params['regex'] as string;
      const flags = (c.params['flags'] as string | undefined) ?? '';
      const text = run.finalText ?? '';
      let matched = false;
      try {
        matched = new RegExp(regexStr, flags).test(text);
      } catch (err) {
        return fail(`invalid regex "${regexStr}": ${String(err)}`);
      }
      if (matched) {
        return pass(`final text matches /${regexStr}/${flags}`);
      }
      return fail(`final text does not match /${regexStr}/${flags}`);
    }

    // ── completed_within_ms ──────────────────────────────────────────────
    case 'completed_within_ms': {
      const ms = c.params['ms'] as number;
      if (run.durationMs <= ms) {
        return pass(`completed in ${run.durationMs}ms (limit ${ms}ms)`);
      }
      return fail(`completed in ${run.durationMs}ms; limit was ${ms}ms`);
    }

    // ── no_errors ────────────────────────────────────────────────────────
    case 'no_errors': {
      const hasFailed = run.events.some((e): e is RunFailedEvent => e.type === 'run.failed');
      const hasToolError = toolExecutedEvents().some(
        (e) => e.status === 'error' || e.error != null,
      );
      if (!hasFailed && !hasToolError) {
        return pass('no error events found');
      }
      const reasons: string[] = [];
      if (hasFailed) reasons.push('run.failed event present');
      if (hasToolError) reasons.push('tool.executed with error present');
      return fail(reasons.join('; '));
    }

    // ── event_count_at_most ──────────────────────────────────────────────
    case 'event_count_at_most': {
      const kind = c.params['kind'] as string;
      const max = c.params['max'] as number;
      const count = run.events.filter((e) => e.type === kind).length;
      if (count <= max) {
        return pass(`${count} "${kind}" event(s); max allowed ${max}`);
      }
      return fail(`${count} "${kind}" event(s) exceeds max of ${max}`);
    }

    // ── unknown kind (runtime guard) ─────────────────────────────────────
    default: {
      return fail(`unknown criterion kind: ${kindStr}`);
    }
  }
}

// ===== Internal helpers ======================================================

/**
 * Build a failed TaskScore for all criteria when the runner did not complete.
 */
function makeFailedTaskScore(
  taskId: string,
  criteria: Criterion[],
  error: string,
  durationMs: number,
): TaskScore {
  const maxScore = criteria.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  const criterionScores: CriterionScore[] = criteria.map((c) => ({
    criterion: c,
    passed: false,
    score: 0,
    reason: 'task did not complete',
  }));
  return {
    taskId,
    totalScore: 0,
    maxScore,
    ratio: 0,
    passed: false,
    durationMs,
    criterionScores,
    error,
  };
}

// ===== runAgentEvals =========================================================

/**
 * Run each eval task sequentially, score criteria, and return a full report.
 *
 * Each task gets its own AbortController wired to `task.timeoutMs` (default
 * 60 000 ms). If the runner throws or is aborted, TaskScore.error is set and
 * all criterion scores are 0.
 */
export async function runAgentEvals(opts: RunEvalsOptions): Promise<EvalReport> {
  const { tasks, runner, onTask } = opts;
  const startedAt = new Date().toISOString();
  const scores: TaskScore[] = [];

  for (const task of tasks) {
    const timeoutMs = task.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const taskStart = Date.now();
    let taskScore: TaskScore;

    try {
      const result = await runner(task, { signal: controller.signal });
      const durationMs = Date.now() - taskStart;

      const criterionScores = task.criteria.map((c) => scoreCriterion(c, result));
      const totalScore = criterionScores.reduce((sum, cs) => sum + cs.score, 0);
      const maxScore = task.criteria.reduce((sum, c) => sum + (c.weight ?? 1), 0);
      const ratio = maxScore === 0 ? 1 : totalScore / maxScore;

      taskScore = {
        taskId: task.id,
        totalScore,
        maxScore,
        ratio,
        passed: ratio === 1,
        durationMs,
        criterionScores,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - taskStart;
      const isTimeout = controller.signal.aborted;
      const message = isTimeout
        ? `timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      taskScore = makeFailedTaskScore(task.id, task.criteria, message, durationMs);
    } finally {
      clearTimeout(timer);
    }

    scores.push(taskScore);
    onTask?.(taskScore);
  }

  const finishedAt = new Date().toISOString();
  const passedTasks = scores.filter((s) => s.passed).length;
  const averageRatio =
    scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s.ratio, 0) / scores.length;

  return {
    totalTasks: tasks.length,
    passedTasks,
    averageRatio,
    startedAt,
    finishedAt,
    scores,
  };
}

// ===== loadTasksFromFile =====================================================

/**
 * Load and parse an AgentEvalTask[] from a JSON file on disk.
 * Throws if the file is missing or contains invalid JSON.
 */
export async function loadTasksFromFile(filePath: string): Promise<AgentEvalTask[]> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as AgentEvalTask[];
}
