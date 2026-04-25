/**
 * pyrfor-metrics-dashboard.ts — Aggregate per-task metrics from Pyrfor iteration runs.
 *
 * Surfaces iteration counts, scores, cost, duration, tokens, and validator
 * failure breakdowns to the CEOClaw dashboard layer.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ── MetricsDashboard ──────────────────────────────────────────────────────────
export class MetricsDashboard {
    constructor(source) {
        this.source = source;
    }
    computeTaskMetrics(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const iters = yield this.source.listIterations(taskId);
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
            const filesSet = new Set();
            const failuresByValidator = {};
            let startedAt = Infinity;
            let endedAt = -Infinity;
            for (const it of iters) {
                bestScore = Math.max(bestScore, it.score.total);
                totalCostUsd += it.envelope.costUsd;
                totalDurationMs += it.durationMs;
                totalInput += it.envelope.usage.input_tokens;
                totalOutput += it.envelope.usage.output_tokens;
                commandsRun += it.envelope.commandsRun.length;
                for (const f of it.envelope.filesTouched)
                    filesSet.add(f);
                if (it.failedValidators) {
                    for (const v of it.failedValidators) {
                        failuresByValidator[v] = ((_a = failuresByValidator[v]) !== null && _a !== void 0 ? _a : 0) + 1;
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
        });
    }
    computeBatch(taskIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.all(taskIds.map(id => this.computeTaskMetrics(id)));
        });
    }
    toMarkdownTable(metrics) {
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
        const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
        const pad = (s, w) => s.padEnd(w);
        const headerRow = '|' + headers.map((h, i) => ` ${pad(h, widths[i])} `).join('|') + '|';
        const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
        const bodyRows = rows
            .map(r => '|' + r.map((c, i) => ` ${pad(c, widths[i])} `).join('|') + '|')
            .join('\n');
        return [headerRow, sep, ...(bodyRows ? [bodyRows] : [])].join('\n');
    }
    toJson(metrics) {
        return JSON.stringify(metrics, null, 2);
    }
}
