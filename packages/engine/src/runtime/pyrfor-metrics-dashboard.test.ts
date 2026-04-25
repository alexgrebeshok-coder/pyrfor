import { describe, it, expect } from 'vitest';
import { MetricsDashboard, type MetricsSource, type IterationData } from './pyrfor-metrics-dashboard';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIter(
  iter: number,
  opts: {
    score: number;
    cost?: number;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    files?: string[];
    commands?: string[];
    failedValidators?: string[];
    startedAt?: number;
    endedAt?: number;
  },
): IterationData {
  return {
    iter,
    envelope: {
      costUsd: opts.cost ?? 0.01,
      usage: {
        input_tokens: opts.inputTokens ?? 100,
        output_tokens: opts.outputTokens ?? 50,
      },
      filesTouched: opts.files ?? [],
      commandsRun: opts.commands ?? [],
    },
    score: { total: opts.score, breakdown: {} },
    durationMs: opts.durationMs ?? 1000,
    startedAt: opts.startedAt ?? 1000,
    endedAt: opts.endedAt ?? 2000,
    failedValidators: opts.failedValidators,
  };
}

function makeSource(iters: IterationData[]): MetricsSource {
  return { listIterations: async () => iters };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MetricsDashboard', () => {
  it('3 iters ascending → bestScore=85, finalScore=85', async () => {
    const dash = new MetricsDashboard(
      makeSource([makeIter(1, { score: 50 }), makeIter(2, { score: 70 }), makeIter(3, { score: 85 })]),
    );
    const m = await dash.computeTaskMetrics('t1');
    expect(m.taskId).toBe('t1');
    expect(m.iterations).toBe(3);
    expect(m.bestScore).toBe(85);
    expect(m.finalScore).toBe(85);
  });

  it('descending scores → bestScore=90, finalScore=80', async () => {
    const dash = new MetricsDashboard(
      makeSource([makeIter(1, { score: 90 }), makeIter(2, { score: 85 }), makeIter(3, { score: 80 })]),
    );
    const m = await dash.computeTaskMetrics('t2');
    expect(m.bestScore).toBe(90);
    expect(m.finalScore).toBe(80);
  });

  it('sums totalCostUsd, totalDurationMs, totalTokens across iterations', async () => {
    const dash = new MetricsDashboard(
      makeSource([
        makeIter(1, { score: 50, cost: 0.01, durationMs: 100, inputTokens: 10, outputTokens: 5 }),
        makeIter(2, { score: 60, cost: 0.02, durationMs: 200, inputTokens: 20, outputTokens: 10 }),
        makeIter(3, { score: 70, cost: 0.03, durationMs: 300, inputTokens: 30, outputTokens: 15 }),
      ]),
    );
    const m = await dash.computeTaskMetrics('t3');
    expect(m.totalCostUsd).toBeCloseTo(0.06);
    expect(m.totalDurationMs).toBe(600);
    expect(m.totalTokens.input).toBe(60);
    expect(m.totalTokens.output).toBe(30);
  });

  it('filesTouched is deduped union, sorted alphabetically', async () => {
    const dash = new MetricsDashboard(
      makeSource([
        makeIter(1, { score: 50, files: ['z.ts', 'a.ts'] }),
        makeIter(2, { score: 60, files: ['b.ts', 'a.ts'] }),
        makeIter(3, { score: 70, files: ['c.ts', 'z.ts'] }),
      ]),
    );
    const m = await dash.computeTaskMetrics('t4');
    expect(m.filesTouched).toEqual(['a.ts', 'b.ts', 'c.ts', 'z.ts']);
  });

  it('failuresByValidator counts per validator across all iterations', async () => {
    const dash = new MetricsDashboard(
      makeSource([
        makeIter(1, { score: 50, failedValidators: ['type-check', 'test-gate'] }),
        makeIter(2, { score: 60, failedValidators: ['type-check'] }),
        makeIter(3, { score: 70 }),
      ]),
    );
    const m = await dash.computeTaskMetrics('t5');
    expect(m.failuresByValidator).toEqual({ 'type-check': 2, 'test-gate': 1 });
  });

  it('toMarkdownTable renders header row and one data row per task', async () => {
    const dash = new MetricsDashboard(makeSource([]));
    const metrics = [
      {
        taskId: 'task-1',
        iterations: 3,
        bestScore: 85,
        finalScore: 80,
        totalCostUsd: 0.06,
        totalDurationMs: 600,
        totalTokens: { input: 300, output: 150 },
        filesTouched: ['a.ts'],
        commandsRun: 6,
        failuresByValidator: {},
        startedAt: 1000,
        endedAt: 2000,
      },
      {
        taskId: 'task-2',
        iterations: 2,
        bestScore: 70,
        finalScore: 70,
        totalCostUsd: 0.04,
        totalDurationMs: 400,
        totalTokens: { input: 200, output: 100 },
        filesTouched: [],
        commandsRun: 4,
        failuresByValidator: {},
        startedAt: 3000,
        endedAt: 4000,
      },
    ];
    const table = dash.toMarkdownTable(metrics);
    const lines = table.split('\n');
    // Header line, separator line, 2 data lines
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('taskId');
    expect(lines[0]).toContain('bestScore');
    expect(lines[2]).toContain('task-1');
    expect(lines[3]).toContain('task-2');
    // Separator uses dashes
    expect(lines[1]).toMatch(/^[|\-]+$/);
  });

  it('toJson produces parseable JSON array of TaskMetrics', async () => {
    const dash = new MetricsDashboard(
      makeSource([makeIter(1, { score: 75 })]),
    );
    const m = await dash.computeTaskMetrics('t6');
    const json = dash.toJson([m]);
    const parsed = JSON.parse(json) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { taskId: string }).taskId).toBe('t6');
  });

  it('commandsRun sums command array lengths across iterations', async () => {
    const dash = new MetricsDashboard(
      makeSource([
        makeIter(1, { score: 50, commands: ['npm test', 'npm lint'] }),
        makeIter(2, { score: 60, commands: ['npm build'] }),
      ]),
    );
    const m = await dash.computeTaskMetrics('t7');
    expect(m.commandsRun).toBe(3);
  });

  it('startedAt = min, endedAt = max across iterations', async () => {
    const dash = new MetricsDashboard(
      makeSource([
        makeIter(1, { score: 50, startedAt: 500, endedAt: 600 }),
        makeIter(2, { score: 60, startedAt: 200, endedAt: 900 }),
        makeIter(3, { score: 70, startedAt: 300, endedAt: 700 }),
      ]),
    );
    const m = await dash.computeTaskMetrics('t8');
    expect(m.startedAt).toBe(200);
    expect(m.endedAt).toBe(900);
  });

  it('computeBatch resolves metrics for each taskId', async () => {
    const source: MetricsSource = {
      listIterations: async (id) => [makeIter(1, { score: id === 'a' ? 10 : 20 })],
    };
    const dash = new MetricsDashboard(source);
    const [ma, mb] = await dash.computeBatch(['a', 'b']);
    expect(ma.taskId).toBe('a');
    expect(ma.finalScore).toBe(10);
    expect(mb.taskId).toBe('b');
    expect(mb.finalScore).toBe(20);
  });
});
