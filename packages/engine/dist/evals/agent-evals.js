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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readFile } from 'node:fs/promises';
// ===== scoreCriterion (pure) =================================================
/**
 * Score a single criterion against a completed agent run result.
 *
 * Pure function — no side effects, no I/O.
 * Unknown criterion kinds produce passed=false with an explanatory reason.
 */
export function scoreCriterion(c, run) {
    var _a, _b, _c, _d, _e, _f;
    const weight = (_a = c.weight) !== null && _a !== void 0 ? _a : 1;
    // Capture kind as plain string so the default branch can reference it even
    // after TypeScript narrows c.kind to `never` inside the exhaustive switch.
    const kindStr = c.kind;
    const pass = (reason) => ({
        criterion: c,
        passed: true,
        score: weight,
        reason,
    });
    const fail = (reason) => ({
        criterion: c,
        passed: false,
        score: 0,
        reason,
    });
    // ── helpers ──────────────────────────────────────────────────────────────
    const toolExecutedEvents = () => run.events.filter((e) => e.type === 'tool.executed');
    // ── switch ───────────────────────────────────────────────────────────────
    switch (c.kind) {
        // ── tool_called ──────────────────────────────────────────────────────
        case 'tool_called': {
            const tool = c.params['tool'];
            const minTimes = (_b = c.params['minTimes']) !== null && _b !== void 0 ? _b : 1;
            const count = toolExecutedEvents().filter((e) => e.tool === tool).length;
            if (count >= minTimes) {
                return pass(`tool "${tool}" called ${count} time(s); required ≥ ${minTimes}`);
            }
            return fail(`tool "${tool}" called ${count} time(s); required ≥ ${minTimes}`);
        }
        // ── tool_not_called ──────────────────────────────────────────────────
        case 'tool_not_called': {
            const tool = c.params['tool'];
            const count = toolExecutedEvents().filter((e) => e.tool === tool).length;
            if (count === 0) {
                return pass(`tool "${tool}" was not called`);
            }
            return fail(`tool "${tool}" was called ${count} time(s); expected 0`);
        }
        // ── final_text_includes ──────────────────────────────────────────────
        case 'final_text_includes': {
            const substr = c.params['substr'];
            const caseSensitive = (_c = c.params['caseSensitive']) !== null && _c !== void 0 ? _c : false;
            const text = (_d = run.finalText) !== null && _d !== void 0 ? _d : '';
            const haystack = caseSensitive ? text : text.toLowerCase();
            const needle = caseSensitive ? substr : substr.toLowerCase();
            if (haystack.includes(needle)) {
                return pass(`final text includes "${substr}"`);
            }
            return fail(`final text does not include "${substr}"`);
        }
        // ── final_text_matches ───────────────────────────────────────────────
        case 'final_text_matches': {
            const regexStr = c.params['regex'];
            const flags = (_e = c.params['flags']) !== null && _e !== void 0 ? _e : '';
            const text = (_f = run.finalText) !== null && _f !== void 0 ? _f : '';
            let matched = false;
            try {
                matched = new RegExp(regexStr, flags).test(text);
            }
            catch (err) {
                return fail(`invalid regex "${regexStr}": ${String(err)}`);
            }
            if (matched) {
                return pass(`final text matches /${regexStr}/${flags}`);
            }
            return fail(`final text does not match /${regexStr}/${flags}`);
        }
        // ── completed_within_ms ──────────────────────────────────────────────
        case 'completed_within_ms': {
            const ms = c.params['ms'];
            if (run.durationMs <= ms) {
                return pass(`completed in ${run.durationMs}ms (limit ${ms}ms)`);
            }
            return fail(`completed in ${run.durationMs}ms; limit was ${ms}ms`);
        }
        // ── no_errors ────────────────────────────────────────────────────────
        case 'no_errors': {
            const hasFailed = run.events.some((e) => e.type === 'run.failed');
            const hasToolError = toolExecutedEvents().some((e) => e.status === 'error' || e.error != null);
            if (!hasFailed && !hasToolError) {
                return pass('no error events found');
            }
            const reasons = [];
            if (hasFailed)
                reasons.push('run.failed event present');
            if (hasToolError)
                reasons.push('tool.executed with error present');
            return fail(reasons.join('; '));
        }
        // ── event_count_at_most ──────────────────────────────────────────────
        case 'event_count_at_most': {
            const kind = c.params['kind'];
            const max = c.params['max'];
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
function makeFailedTaskScore(taskId, criteria, error, durationMs) {
    const maxScore = criteria.reduce((sum, c) => { var _a; return sum + ((_a = c.weight) !== null && _a !== void 0 ? _a : 1); }, 0);
    const criterionScores = criteria.map((c) => ({
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
export function runAgentEvals(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { tasks, runner, onTask } = opts;
        const startedAt = new Date().toISOString();
        const scores = [];
        for (const task of tasks) {
            const timeoutMs = (_a = task.timeoutMs) !== null && _a !== void 0 ? _a : 60000;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const taskStart = Date.now();
            let taskScore;
            try {
                const result = yield runner(task, { signal: controller.signal });
                const durationMs = Date.now() - taskStart;
                const criterionScores = task.criteria.map((c) => scoreCriterion(c, result));
                const totalScore = criterionScores.reduce((sum, cs) => sum + cs.score, 0);
                const maxScore = task.criteria.reduce((sum, c) => { var _a; return sum + ((_a = c.weight) !== null && _a !== void 0 ? _a : 1); }, 0);
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
            }
            catch (err) {
                const durationMs = Date.now() - taskStart;
                const isTimeout = controller.signal.aborted;
                const message = isTimeout
                    ? `timeout after ${timeoutMs}ms`
                    : err instanceof Error
                        ? err.message
                        : String(err);
                taskScore = makeFailedTaskScore(task.id, task.criteria, message, durationMs);
            }
            finally {
                clearTimeout(timer);
            }
            scores.push(taskScore);
            onTask === null || onTask === void 0 ? void 0 : onTask(taskScore);
        }
        const finishedAt = new Date().toISOString();
        const passedTasks = scores.filter((s) => s.passed).length;
        const averageRatio = scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s.ratio, 0) / scores.length;
        return {
            totalTasks: tasks.length,
            passedTasks,
            averageRatio,
            startedAt,
            finishedAt,
            scores,
        };
    });
}
// ===== loadTasksFromFile =====================================================
/**
 * Load and parse an AgentEvalTask[] from a JSON file on disk.
 * Throws if the file is missing or contains invalid JSON.
 */
export function loadTasksFromFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const raw = yield readFile(filePath, 'utf8');
        return JSON.parse(raw);
    });
}
