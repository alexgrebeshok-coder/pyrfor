/**
 * pyrfor-metrics-dashboard.ts — Aggregate per-task metrics from Pyrfor iteration runs.
 *
 * Surfaces iteration counts, scores, cost, duration, tokens, and validator
 * failure breakdowns to the CEOClaw dashboard layer.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface TaskMetrics {
  taskId: string;
  iterations: number;
  bestScore: number;
  finalScore: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalTokens: { input: number; output: number };
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
    usage: { input_tokens: number; output_tokens: number };
    filesTouched: string[];
    commandsRun: unknown[];
  };
  score: { total: number; breakdown: unknown };
  durationMs: number;
  startedAt: number;
  endedAt: number;
  failedValidators?: string[];
}

export interface MetricsSource {
  listIterations(taskId: string): Promise<IterationData[]>;
}

// ── MetricsDashboard ──────────────────────────────────────────────────────────

export class MetricsDashboard {
  constructor(private readonly source: MetricsSource) {}

  async computeTaskMetrics(taskId: string): Promise<TaskMetrics> {
    const iters = await this.source.listIterations(taskId);

    if (iters.length === 0) {
      return {
        taskId,
        iterations: 0,
        bestScore: 0,
        finalScore: 0,
        totalCostUsd: 0,
        totalDurationMs: 0,
        totalTokens: { input: 0, output: 0 },
        filesTouched: [],
        commandsRun: 0,
        failuresByValidator: {},
        startedAt: 0,
        endedAt: 0,
      };
    }

    let bestScore = -Infinity;
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let commandsRun = 0;
    const filesSet = new Set<string>();
    const failuresByValidator: Record<string, number> = {};
    let startedAt = Infinity;
    let endedAt = -Infinity;

    for (const it of iters) {
      bestScore = Math.max(bestScore, it.score.total);
      totalCostUsd += it.envelope.costUsd;
      totalDurationMs += it.durationMs;
      totalInput += it.envelope.usage.input_tokens;
      totalOutput += it.envelope.usage.output_tokens;
      commandsRun += it.envelope.commandsRun.length;
      for (const f of it.envelope.filesTouched) filesSet.add(f);
      if (it.failedValidators) {
        for (const v of it.failedValidators) {
          failuresByValidator[v] = (failuresByValidator[v] ?? 0) + 1;
        }
      }
      startedAt = Math.min(startedAt, it.startedAt);
      endedAt = Math.max(endedAt, it.endedAt);
    }

    const finalScore = iters[iters.length - 1].score.total;

    return {
      taskId,
      iterations: iters.length,
      bestScore,
      finalScore,
      totalCostUsd,
      totalDurationMs,
      totalTokens: { input: totalInput, output: totalOutput },
      filesTouched: Array.from(filesSet).sort(),
      commandsRun,
      failuresByValidator,
      startedAt,
      endedAt,
    };
  }

  async computeBatch(taskIds: string[]): Promise<TaskMetrics[]> {
    return Promise.all(taskIds.map(id => this.computeTaskMetrics(id)));
  }

  toMarkdownTable(metrics: TaskMetrics[]): string {
    const headers = [
      'taskId', 'iterations', 'bestScore', 'finalScore',
      'totalCostUsd', 'totalDurationMs', 'inputTokens', 'outputTokens', 'commandsRun',
    ];

    const rows = metrics.map(m => [
      m.taskId,
      String(m.iterations),
      String(m.bestScore),
      String(m.finalScore),
      m.totalCostUsd.toFixed(6),
      String(m.totalDurationMs),
      String(m.totalTokens.input),
      String(m.totalTokens.output),
      String(m.commandsRun),
    ]);

    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => r[i].length)),
    );

    const pad = (s: string, w: number) => s.padEnd(w);
    const headerRow = '|' + headers.map((h, i) => ` ${pad(h, widths[i])} `).join('|') + '|';
    const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
    const bodyRows = rows
      .map(r => '|' + r.map((c, i) => ` ${pad(c, widths[i])} `).join('|') + '|')
      .join('\n');

    return [headerRow, sep, ...(bodyRows ? [bodyRows] : [])].join('\n');
  }

  toJson(metrics: TaskMetrics[]): string {
    return JSON.stringify(metrics, null, 2);
  }
}
