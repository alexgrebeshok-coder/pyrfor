/**
 * agent-evals.test.ts — Vitest unit tests for the agent-evals module.
 *
 * Coverage:
 *  - scoreCriterion: each CriterionKind (positive + negative), weight, unknown kind
 *  - runAgentEvals: pass/fail tasks, runner throws, timeout, report counters,
 *    averageRatio, onTask callback, empty task list
 *  - loadTasksFromFile: fixture parsing, missing-file error
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scoreCriterion,
  runAgentEvals,
  loadTasksFromFile,
  type Criterion,
  type AgentRunResult,
  type AgentEvalTask,
  type AgentRunner,
} from './agent-evals.js';
import type { LedgerEvent } from '../runtime/event-ledger.js';

// ===== Test helpers ==========================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'agent-eval-tasks.json');

let _seq = 0;

function makeEvent(partial: Omit<LedgerEvent, 'id' | 'ts' | 'seq'>): LedgerEvent {
  return {
    id: `evt-${_seq}`,
    ts: new Date().toISOString(),
    seq: _seq++,
    ...partial,
  } as LedgerEvent;
}

function toolExecuted(tool: string, error?: string, status?: string): LedgerEvent {
  return makeEvent({
    type: 'tool.executed',
    run_id: 'run-1',
    tool,
    ...(error !== undefined ? { error } : {}),
    ...(status !== undefined ? { status } : {}),
  });
}

function runFailed(error = 'something went wrong'): LedgerEvent {
  return makeEvent({ type: 'run.failed', run_id: 'run-1', error });
}

function modelTurnStarted(): LedgerEvent {
  return makeEvent({ type: 'model.turn.started', run_id: 'run-1' });
}

function emptyRun(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { events: [], finalText: undefined, durationMs: 100, ...overrides };
}

// ===== scoreCriterion — tool_called ==========================================

describe('scoreCriterion / tool_called', () => {
  it('passes when tool was executed at least once (default minTimes=1)', () => {
    const c: Criterion = { kind: 'tool_called', params: { tool: 'read_file' } };
    const run = emptyRun({ events: [toolExecuted('read_file')] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when tool was never executed', () => {
    const c: Criterion = { kind: 'tool_called', params: { tool: 'read_file' } };
    const run = emptyRun({ events: [toolExecuted('other_tool')] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('passes when minTimes=2 and tool executed twice', () => {
    const c: Criterion = {
      kind: 'tool_called',
      params: { tool: 'search', minTimes: 2 },
    };
    const run = emptyRun({ events: [toolExecuted('search'), toolExecuted('search')] });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when minTimes=2 but tool executed only once', () => {
    const c: Criterion = {
      kind: 'tool_called',
      params: { tool: 'search', minTimes: 2 },
    };
    const run = emptyRun({ events: [toolExecuted('search')] });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });

  it('earns weight=2 when passed', () => {
    const c: Criterion = { kind: 'tool_called', params: { tool: 'write_file' }, weight: 2 };
    const run = emptyRun({ events: [toolExecuted('write_file')] });
    const result = scoreCriterion(c, run);
    expect(result.score).toBe(2);
    expect(result.passed).toBe(true);
  });

  it('scores 0 (not weight) when failed, weight=2', () => {
    const c: Criterion = { kind: 'tool_called', params: { tool: 'write_file' }, weight: 2 };
    const run = emptyRun();
    const result = scoreCriterion(c, run);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });
});

// ===== scoreCriterion — tool_not_called ======================================

describe('scoreCriterion / tool_not_called', () => {
  it('passes when tool was never called', () => {
    const c: Criterion = { kind: 'tool_not_called', params: { tool: 'rm_rf' } };
    const run = emptyRun({ events: [toolExecuted('list_files')] });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when tool was called', () => {
    const c: Criterion = { kind: 'tool_not_called', params: { tool: 'rm_rf' } };
    const run = emptyRun({ events: [toolExecuted('rm_rf')] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/1 time/);
  });
});

// ===== scoreCriterion — final_text_includes ==================================

describe('scoreCriterion / final_text_includes', () => {
  it('passes case-insensitively by default', () => {
    const c: Criterion = {
      kind: 'final_text_includes',
      params: { substr: 'Hello' },
    };
    const run = emptyRun({ finalText: 'hello world' });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when substring not present', () => {
    const c: Criterion = {
      kind: 'final_text_includes',
      params: { substr: 'foobar' },
    };
    const run = emptyRun({ finalText: 'hello world' });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });

  it('passes case-sensitively when caseSensitive=true and case matches', () => {
    const c: Criterion = {
      kind: 'final_text_includes',
      params: { substr: 'Hello', caseSensitive: true },
    };
    const run = emptyRun({ finalText: 'Hello World' });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails case-sensitively when case does not match', () => {
    const c: Criterion = {
      kind: 'final_text_includes',
      params: { substr: 'Hello', caseSensitive: true },
    };
    const run = emptyRun({ finalText: 'hello world' });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });

  it('treats missing finalText as empty string', () => {
    const c: Criterion = {
      kind: 'final_text_includes',
      params: { substr: 'anything' },
    };
    const run = emptyRun({ finalText: undefined });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });
});

// ===== scoreCriterion — final_text_matches ===================================

describe('scoreCriterion / final_text_matches', () => {
  it('passes when regex matches', () => {
    const c: Criterion = {
      kind: 'final_text_matches',
      params: { regex: '\\d+' },
    };
    const run = emptyRun({ finalText: 'result is 42' });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when regex does not match', () => {
    const c: Criterion = {
      kind: 'final_text_matches',
      params: { regex: '^ERROR' },
    };
    const run = emptyRun({ finalText: 'everything is fine' });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });

  it('applies flags (case-insensitive)', () => {
    const c: Criterion = {
      kind: 'final_text_matches',
      params: { regex: 'success', flags: 'i' },
    };
    const run = emptyRun({ finalText: 'SUCCESS' });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('returns failed with explanatory reason for invalid regex', () => {
    const c: Criterion = {
      kind: 'final_text_matches',
      params: { regex: '[invalid' },
    };
    const run = emptyRun({ finalText: 'text' });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/invalid regex/i);
  });
});

// ===== scoreCriterion — completed_within_ms ==================================

describe('scoreCriterion / completed_within_ms', () => {
  it('passes when durationMs is under the limit', () => {
    const c: Criterion = { kind: 'completed_within_ms', params: { ms: 1000 } };
    const run = emptyRun({ durationMs: 500 });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('passes when durationMs equals the limit exactly', () => {
    const c: Criterion = { kind: 'completed_within_ms', params: { ms: 1000 } };
    const run = emptyRun({ durationMs: 1000 });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when durationMs exceeds the limit', () => {
    const c: Criterion = { kind: 'completed_within_ms', params: { ms: 1000 } };
    const run = emptyRun({ durationMs: 1001 });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });
});

// ===== scoreCriterion — no_errors ============================================

describe('scoreCriterion / no_errors', () => {
  it('passes when events contain no errors', () => {
    const c: Criterion = { kind: 'no_errors', params: {} };
    const run = emptyRun({ events: [toolExecuted('read_file'), modelTurnStarted()] });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when run.failed event is present', () => {
    const c: Criterion = { kind: 'no_errors', params: {} };
    const run = emptyRun({ events: [runFailed()] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/run\.failed/);
  });

  it('fails when tool.executed has status=error', () => {
    const c: Criterion = { kind: 'no_errors', params: {} };
    const run = emptyRun({ events: [toolExecuted('calc', undefined, 'error')] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/tool\.executed/);
  });

  it('fails when tool.executed has an error field set', () => {
    const c: Criterion = { kind: 'no_errors', params: {} };
    const run = emptyRun({ events: [toolExecuted('calc', 'divide by zero')] });
    expect(scoreCriterion(c, run).passed).toBe(false);
  });

  it('passes with empty event list', () => {
    const c: Criterion = { kind: 'no_errors', params: {} };
    expect(scoreCriterion(c, emptyRun()).passed).toBe(true);
  });
});

// ===== scoreCriterion — event_count_at_most ==================================

describe('scoreCriterion / event_count_at_most', () => {
  it('passes when count is under the max', () => {
    const c: Criterion = {
      kind: 'event_count_at_most',
      params: { kind: 'model.turn.started', max: 3 },
    };
    const run = emptyRun({ events: [modelTurnStarted(), modelTurnStarted()] });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('passes when count equals max exactly', () => {
    const c: Criterion = {
      kind: 'event_count_at_most',
      params: { kind: 'model.turn.started', max: 2 },
    };
    const run = emptyRun({ events: [modelTurnStarted(), modelTurnStarted()] });
    expect(scoreCriterion(c, run).passed).toBe(true);
  });

  it('fails when count exceeds max', () => {
    const c: Criterion = {
      kind: 'event_count_at_most',
      params: { kind: 'model.turn.started', max: 1 },
    };
    const run = emptyRun({ events: [modelTurnStarted(), modelTurnStarted()] });
    const result = scoreCriterion(c, run);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/exceeds/i);
  });

  it('passes with zero events and max=0', () => {
    const c: Criterion = {
      kind: 'event_count_at_most',
      params: { kind: 'tool.executed', max: 0 },
    };
    expect(scoreCriterion(c, emptyRun()).passed).toBe(true);
  });
});

// ===== scoreCriterion — unknown kind =========================================

describe('scoreCriterion / unknown kind', () => {
  it('returns passed=false with reason containing the unknown kind string', () => {
    // Force an unknown kind through the type system at runtime
    const c = { kind: 'banana_split' as unknown as 'tool_called', params: {} };
    const result = scoreCriterion(c, emptyRun());
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/unknown criterion kind: banana_split/);
  });
});

// ===== scoreCriterion — weight contribution ==================================

describe('scoreCriterion / weight', () => {
  it('criterion with weight=3 contributes 3 to score when passed', () => {
    const c: Criterion = {
      kind: 'no_errors',
      params: {},
      weight: 3,
    };
    const result = scoreCriterion(c, emptyRun());
    expect(result.score).toBe(3);
  });

  it('criterion with weight=3 contributes 0 when failed', () => {
    const c: Criterion = {
      kind: 'no_errors',
      params: {},
      weight: 3,
    };
    const run = emptyRun({ events: [runFailed()] });
    expect(scoreCriterion(c, run).score).toBe(0);
  });
});

// ===== runAgentEvals — basic pass / fail =====================================

describe('runAgentEvals / basic', () => {
  it('returns passed=true when all criteria pass', async () => {
    const task: AgentEvalTask = {
      id: 'task-pass',
      prompt: 'do the thing',
      criteria: [
        { kind: 'final_text_includes', params: { substr: 'done' } },
        { kind: 'no_errors', params: {} },
      ],
    };

    const runner: AgentRunner = async () => ({
      events: [],
      finalText: 'task done',
      durationMs: 50,
    });

    const report = await runAgentEvals({ tasks: [task], runner });
    expect(report.scores[0].passed).toBe(true);
    expect(report.scores[0].ratio).toBe(1);
    expect(report.passedTasks).toBe(1);
  });

  it('returns passed=false when a criterion fails', async () => {
    const task: AgentEvalTask = {
      id: 'task-fail',
      prompt: 'do the thing',
      criteria: [{ kind: 'final_text_includes', params: { substr: 'success' } }],
    };

    const runner: AgentRunner = async () => ({
      events: [],
      finalText: 'no match here',
      durationMs: 50,
    });

    const report = await runAgentEvals({ tasks: [task], runner });
    expect(report.scores[0].passed).toBe(false);
    expect(report.scores[0].ratio).toBe(0);
    expect(report.passedTasks).toBe(0);
  });
});

// ===== runAgentEvals — weights in TaskScore ==================================

describe('runAgentEvals / weights', () => {
  it('totalScore and maxScore reflect criterion weights', async () => {
    const task: AgentEvalTask = {
      id: 'weighted',
      prompt: 'p',
      criteria: [
        { kind: 'no_errors', params: {}, weight: 2 },
        { kind: 'final_text_includes', params: { substr: 'yes' }, weight: 3 },
      ],
    };

    const runner: AgentRunner = async () => ({
      events: [],
      finalText: 'yes',
      durationMs: 10,
    });

    const report = await runAgentEvals({ tasks: [task], runner });
    const s = report.scores[0];
    expect(s.maxScore).toBe(5);   // 2 + 3
    expect(s.totalScore).toBe(5); // both pass
    expect(s.ratio).toBe(1);
  });

  it('partial weights produce correct ratio', async () => {
    const task: AgentEvalTask = {
      id: 'partial',
      prompt: 'p',
      criteria: [
        { kind: 'no_errors', params: {}, weight: 2 },      // passes
        { kind: 'final_text_includes', params: { substr: 'nope' }, weight: 3 }, // fails
      ],
    };

    const runner: AgentRunner = async () => ({
      events: [],
      finalText: 'all good',
      durationMs: 10,
    });

    const report = await runAgentEvals({ tasks: [task], runner });
    const s = report.scores[0];
    expect(s.maxScore).toBe(5);
    expect(s.totalScore).toBe(2);
    expect(s.ratio).toBeCloseTo(2 / 5);
    expect(s.passed).toBe(false);
  });
});

// ===== runAgentEvals — runner throws =========================================

describe('runAgentEvals / runner throws', () => {
  it('sets error on TaskScore and scores all criteria 0', async () => {
    const task: AgentEvalTask = {
      id: 'throws',
      prompt: 'p',
      criteria: [
        { kind: 'no_errors', params: {} },
        { kind: 'final_text_includes', params: { substr: 'hi' } },
      ],
    };

    const runner: AgentRunner = async () => {
      throw new Error('agent exploded');
    };

    const report = await runAgentEvals({ tasks: [task], runner });
    const s = report.scores[0];
    expect(s.error).toMatch(/agent exploded/);
    expect(s.passed).toBe(false);
    expect(s.ratio).toBe(0);
    expect(s.criterionScores.every((cs) => cs.score === 0)).toBe(true);
    expect(s.criterionScores.every((cs) => cs.reason === 'task did not complete')).toBe(true);
  });
});

// ===== runAgentEvals — timeout ===============================================

describe('runAgentEvals / timeout', () => {
  it('aborts the runner and sets error containing "timeout"', async () => {
    const task: AgentEvalTask = {
      id: 'slow',
      prompt: 'takes forever',
      criteria: [{ kind: 'no_errors', params: {} }],
      timeoutMs: 30, // very short
    };

    const runner: AgentRunner = (_task, { signal }) =>
      new Promise<AgentRunResult>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by signal')));
        // Never resolves on its own; the timeout fires first
      });

    const report = await runAgentEvals({ tasks: [task], runner });
    const s = report.scores[0];
    expect(s.error).toMatch(/timeout/i);
    expect(s.passed).toBe(false);
    expect(s.ratio).toBe(0);
  });
});

// ===== runAgentEvals — report counters & averageRatio ========================

describe('runAgentEvals / report', () => {
  it('counts totalTasks and passedTasks correctly across mixed results', async () => {
    const passing: AgentEvalTask = {
      id: 'p1',
      prompt: 'pass',
      criteria: [{ kind: 'no_errors', params: {} }],
    };
    const failing: AgentEvalTask = {
      id: 'f1',
      prompt: 'fail',
      criteria: [{ kind: 'final_text_includes', params: { substr: 'NEVER' } }],
    };

    const runner: AgentRunner = async (t) => ({
      events: [],
      finalText: 'ok',
      durationMs: 10,
    });

    const report = await runAgentEvals({ tasks: [passing, failing], runner });
    expect(report.totalTasks).toBe(2);
    expect(report.passedTasks).toBe(1);
    expect(report.averageRatio).toBeCloseTo(0.5);
  });

  it('averageRatio is 1 when all tasks pass', async () => {
    const tasks: AgentEvalTask[] = [
      { id: 't1', prompt: 'p', criteria: [{ kind: 'no_errors', params: {} }] },
      { id: 't2', prompt: 'p', criteria: [{ kind: 'no_errors', params: {} }] },
    ];
    const runner: AgentRunner = async () => ({ events: [], durationMs: 5 });
    const report = await runAgentEvals({ tasks, runner });
    expect(report.averageRatio).toBe(1);
  });

  it('averageRatio is 0 when all tasks fail', async () => {
    const tasks: AgentEvalTask[] = [
      {
        id: 'x1',
        prompt: 'p',
        criteria: [{ kind: 'final_text_includes', params: { substr: 'NOPE' } }],
      },
    ];
    const runner: AgentRunner = async () => ({ events: [], finalText: '', durationMs: 5 });
    const report = await runAgentEvals({ tasks, runner });
    expect(report.averageRatio).toBe(0);
  });

  it('handles empty task list gracefully', async () => {
    const runner: AgentRunner = vi.fn();
    const report = await runAgentEvals({ tasks: [], runner });
    expect(report.totalTasks).toBe(0);
    expect(report.passedTasks).toBe(0);
    expect(report.averageRatio).toBe(0);
    expect(report.scores).toHaveLength(0);
    expect(vi.mocked(runner)).not.toHaveBeenCalled();
  });

  it('includes startedAt and finishedAt as valid ISO strings', async () => {
    const report = await runAgentEvals({ tasks: [], runner: vi.fn() });
    expect(() => new Date(report.startedAt)).not.toThrow();
    expect(() => new Date(report.finishedAt)).not.toThrow();
  });
});

// ===== runAgentEvals — onTask callback =======================================

describe('runAgentEvals / onTask', () => {
  it('fires once per task with the TaskScore', async () => {
    const tasks: AgentEvalTask[] = [
      { id: 'a', prompt: 'p', criteria: [] },
      { id: 'b', prompt: 'p', criteria: [] },
    ];
    const runner: AgentRunner = async () => ({ events: [], durationMs: 5 });

    const seen: string[] = [];
    await runAgentEvals({
      tasks,
      runner,
      onTask: (s) => seen.push(s.taskId),
    });

    expect(seen).toEqual(['a', 'b']);
  });

  it('fires even when runner throws', async () => {
    const task: AgentEvalTask = { id: 'err', prompt: 'p', criteria: [] };
    const runner: AgentRunner = async () => {
      throw new Error('boom');
    };

    const fired: boolean[] = [];
    await runAgentEvals({ tasks: [task], runner, onTask: () => fired.push(true) });
    expect(fired).toHaveLength(1);
  });
});

// ===== loadTasksFromFile =====================================================

describe('loadTasksFromFile', () => {
  it('parses the bundled fixture and returns an array of tasks', async () => {
    const tasks = await loadTasksFromFile(FIXTURE_PATH);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    for (const t of tasks) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.prompt).toBe('string');
      expect(Array.isArray(t.criteria)).toBe(true);
    }
  });

  it('throws when the file does not exist', async () => {
    await expect(
      loadTasksFromFile('/no/such/file/tasks.json'),
    ).rejects.toThrow();
  });
});
