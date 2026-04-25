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
  byModel: Record<
    string,
    { costUsd: number; promptTokens: number; completionTokens: number; sessions: number }
  >;
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
export function envelopeToSessionCost(env: FCEnvelope, now?: () => number): FcSessionCost {
  const clock = now ?? (() => Date.now());
  const ts = clock();

  // Extract usage with tolerant fallbacks
  const usage = env.usage ?? {};
  const promptTokens =
    usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const completionTokens =
    usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cacheReadTokens =
    usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? 0;
  const cacheCreationTokens =
    usage.cache_creation_input_tokens ?? usage.cache_creation_tokens ?? 0;

  const costUsd = env.costUsd ?? 0;

  return {
    sessionId: env.sessionId,
    model: env.model,
    costUsd,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheCreationTokens,
    durationMs: env.durationMs,
    filesTouched: env.filesTouched?.length ?? 0,
    commandsRun: env.commandsRun?.length ?? 0,
    status: env.status,
    startedAt: ts,
    finishedAt: ts,
  };
}

interface TaskState {
  taskId: string;
  startedAt: number;
  finishedAt?: number;
  sessions: FcSessionCost[];
}

export function createCostAggregator(opts?: CostAggregatorOptions): CostAggregator {
  const clock = opts?.now ?? (() => Date.now());
  const costTracker = opts?.costTracker;

  const tasks = new Map<string, TaskState>();
  let nextTaskId = 0;

  function buildSummary(state: TaskState): TaskCostSummary {
    const sessions = state.sessions;

    const totals = {
      sessions: sessions.length,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      filesTouched: 0,
      commandsRun: 0,
      durationMs: 0,
    };

    const byModel: Record<
      string,
      { costUsd: number; promptTokens: number; completionTokens: number; sessions: number }
    > = {};

    for (const s of sessions) {
      totals.costUsd += s.costUsd;
      totals.promptTokens += s.promptTokens;
      totals.completionTokens += s.completionTokens;
      totals.cacheReadTokens += s.cacheReadTokens ?? 0;
      totals.cacheCreationTokens += s.cacheCreationTokens ?? 0;
      totals.filesTouched += s.filesTouched;
      totals.commandsRun += s.commandsRun;
      totals.durationMs += s.durationMs ?? 0;

      const model = s.model ?? 'unknown';
      if (!byModel[model]) {
        byModel[model] = { costUsd: 0, promptTokens: 0, completionTokens: 0, sessions: 0 };
      }
      byModel[model].costUsd += s.costUsd;
      byModel[model].promptTokens += s.promptTokens;
      byModel[model].completionTokens += s.completionTokens;
      byModel[model].sessions += 1;
    }

    return {
      taskId: state.taskId,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      sessions: [...sessions],
      totals,
      byModel,
    };
  }

  return {
    startTask(taskId?: string): string {
      const id = taskId ?? `task-${nextTaskId++}`;
      const ts = clock();
      tasks.set(id, {
        taskId: id,
        startedAt: ts,
        sessions: [],
      });
      return id;
    },

    recordFcRun(taskId: string, envelope: FCEnvelope): FcSessionCost {
      const state = tasks.get(taskId);
      if (!state) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const sessionCost = envelopeToSessionCost(envelope, clock);
      state.sessions.push(sessionCost);

      // Record to costTracker if provided
      if (costTracker) {
        const model = envelope.model ?? 'unknown';
        costTracker.record(
          model,
          sessionCost.promptTokens,
          sessionCost.completionTokens,
          { sessionId: sessionCost.sessionId, taskId, source: 'fc' },
        );
      }

      return sessionCost;
    },

    finishTask(taskId: string): TaskCostSummary {
      const state = tasks.get(taskId);
      if (!state) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const ts = clock();
      state.finishedAt = ts;

      return buildSummary(state);
    },

    getSummary(taskId: string): TaskCostSummary | null {
      const state = tasks.get(taskId);
      if (!state) {
        return null;
      }
      return buildSummary(state);
    },

    listTasks(): TaskCostSummary[] {
      return Array.from(tasks.values()).map(buildSummary);
    },
  };
}
