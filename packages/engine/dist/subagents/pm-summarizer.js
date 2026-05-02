/**
 * PM-Summarizer Subagent
 *
 * Single-purpose subagent that consumes a stream of LedgerEvents from one or
 * more agent runs and produces a deterministic, Project-Manager-facing summary:
 * what got done, what is blocked, who/what acted, time-on-task, and top issues.
 *
 * No LLM involvement — pure aggregation intended to be fed downstream to an
 * LLM for prose generation or surfaced directly in dashboards and sprint reviews.
 *
 * Usage:
 *   import { runPmSummarizer } from './pm-summarizer.js';
 *   const summary = await runPmSummarizer({ events });
 *
 * @module pm-summarizer
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
// ====== Constants ======
const DEFAULT_TOP_TOOLS_LIMIT = 5;
const DEFAULT_NOTABLE_ERRORS_LIMIT = 3;
const FINAL_TEXT_PREVIEW_LEN = 240;
/** Bucket key used for events that carry no run_id. */
const UNKNOWN_RUN_ID = '__unknown__';
// ====== Regex helpers ======
/** Matches event types that represent a completed/finished run. */
const RE_STATUS_COMPLETED = /run.?completed|run.?finished|completed/i;
/** Matches event types that represent a failed run or generic error state. */
const RE_STATUS_FAILED = /run.?failed/i;
/** Matches event types that represent a cancelled or aborted run. */
const RE_STATUS_CANCELLED = /cancel|abort/i;
/** Matches event types indicating a run has been initiated. */
const RE_STATUS_STARTED = /run.?creat|run.?start/i;
/** Matches event types / levels that indicate an error condition. */
const RE_ERROR_TYPE = /error/i;
/** Matches event types associated with a permission or approval check. */
const RE_PERMISSION = /permission/i;
/** Matches event types that carry an assistant / model text payload. */
const RE_ASSISTANT_MSG = /assistant.?message|final.?text/i;
/** Matches event types representing a tool invocation or execution. */
const RE_TOOL_CALL = /tool.?(call|exec)/i;
// ====== Pure field-extraction helpers ======
/**
 * Coerce an event to a plain key/value bag for defensive field access.
 * Avoids spreading the discriminated-union type throughout the module.
 */
function asRaw(e) {
    return e;
}
/**
 * Extract a tool name from an event.
 * Checks top-level `tool` first, then `data.tool` as a defensive fallback.
 */
function extractTool(e) {
    const raw = asRaw(e);
    const top = raw['tool'];
    if (typeof top === 'string' && top)
        return top;
    const data = raw['data'];
    const nested = data === null || data === void 0 ? void 0 : data['tool'];
    if (typeof nested === 'string' && nested)
        return nested;
    return undefined;
}
/**
 * Extract a duration value (ms) from an event.
 * Checks top-level `ms` first, then `data.durationMs` as a fallback.
 */
function extractMs(e) {
    const raw = asRaw(e);
    const top = raw['ms'];
    if (typeof top === 'number')
        return top;
    const data = raw['data'];
    const nested = data === null || data === void 0 ? void 0 : data['durationMs'];
    if (typeof nested === 'number')
        return nested;
    return 0;
}
/**
 * Return true when the event represents a tool call or execution.
 * Matches type against RE_TOOL_CALL, or falls back to the presence of a `tool`
 * field (handles future event shapes defensively).
 */
function isToolCallEvent(e) {
    return RE_TOOL_CALL.test(e.type) || extractTool(e) !== undefined;
}
/**
 * Return true when the event represents an error condition.
 *
 * Strategy (in order):
 *  1. Type is `run.failed` (always an error by definition).
 *  2. Type string contains the word "error" (e.g. a hypothetical "tool.error").
 *  3. A top-level `error` field is truthy.
 *  4. A `data.error` nested field is truthy (defensive for future shapes).
 */
function isErrorEvent(e) {
    if (e.type === 'run.failed')
        return true;
    if (RE_ERROR_TYPE.test(e.type))
        return true;
    const raw = asRaw(e);
    if (raw['error'])
        return true;
    const data = raw['data'];
    if (data === null || data === void 0 ? void 0 : data['error'])
        return true;
    return false;
}
/**
 * Return true when the event represents a permission or approval denial.
 *
 * Strategy:
 *  1. Direct match on `approval.denied` or `tool.denied` ledger types.
 *  2. Defensive: type matches RE_PERMISSION AND (data.outcome==='denied' OR
 *     data.allowed===false OR top-level allowed===false).
 */
function isPermissionDeniedEvent(e) {
    if (e.type === 'approval.denied' || e.type === 'tool.denied')
        return true;
    if (RE_PERMISSION.test(e.type)) {
        const raw = asRaw(e);
        const data = raw['data'];
        if ((data === null || data === void 0 ? void 0 : data['outcome']) === 'denied' ||
            (data === null || data === void 0 ? void 0 : data['allowed']) === false ||
            raw['allowed'] === false)
            return true;
    }
    return false;
}
/**
 * Extract a human-readable error message from an error event.
 *
 * Search order (most to least specific):
 *  data.error.message → data.error (string) → error.message → error (string)
 *  → data.message → message → 'unknown error'
 */
function extractErrorMessage(e) {
    const raw = asRaw(e);
    const data = raw['data'];
    // data.error (object or string)
    const dataErr = data === null || data === void 0 ? void 0 : data['error'];
    if (dataErr && typeof dataErr === 'object') {
        const m = dataErr['message'];
        if (typeof m === 'string' && m)
            return m;
    }
    if (typeof dataErr === 'string' && dataErr)
        return dataErr;
    // top-level error (object or string)
    const topErr = raw['error'];
    if (topErr && typeof topErr === 'object') {
        const m = topErr['message'];
        if (typeof m === 'string' && m)
            return m;
    }
    if (typeof topErr === 'string' && topErr)
        return topErr;
    // fallback message fields
    const dataMsg = data === null || data === void 0 ? void 0 : data['message'];
    if (typeof dataMsg === 'string' && dataMsg)
        return dataMsg;
    const topMsg = raw['message'];
    if (typeof topMsg === 'string' && topMsg)
        return topMsg;
    return 'unknown error';
}
/**
 * Truncate `s` to at most `maxLen` characters, appending "…" when truncated.
 */
function truncate(s, maxLen) {
    return s.length <= maxLen ? s : s.slice(0, maxLen) + '\u2026';
}
// ====== Core exports ======
/**
 * Group a flat array of LedgerEvents into a Map keyed by run_id.
 *
 * Events whose `run_id` is absent or empty are collected under the special
 * bucket key `'__unknown__'`.  Within each bucket events remain in their
 * original order.
 */
export function groupEventsByRun(events) {
    const map = new Map();
    for (const e of events) {
        const key = e.run_id || UNKNOWN_RUN_ID;
        let bucket = map.get(key);
        if (!bucket) {
            bucket = [];
            map.set(key, bucket);
        }
        bucket.push(e);
    }
    return map;
}
/**
 * Produce a RunSummary for a homogenous slice of events belonging to one run.
 *
 * `runId` is inferred from the first event's `run_id`; callers may override
 * via the returned value after this call.  `opts` controls output limits.
 */
export function summarizeRun(events, opts) {
    var _a, _b, _c, _d, _e, _f, _g;
    const topToolsLimit = (_a = opts === null || opts === void 0 ? void 0 : opts.topToolsLimit) !== null && _a !== void 0 ? _a : DEFAULT_TOP_TOOLS_LIMIT;
    const notableErrorsLimit = (_b = opts === null || opts === void 0 ? void 0 : opts.notableErrorsLimit) !== null && _b !== void 0 ? _b : DEFAULT_NOTABLE_ERRORS_LIMIT;
    const runId = ((_c = events[0]) === null || _c === void 0 ? void 0 : _c.run_id) || UNKNOWN_RUN_ID;
    // ── Status detection ──────────────────────────────────────────────────────
    let hasCompleted = false;
    let hasFailed = false;
    let hasCancelled = false;
    let hasStarted = false;
    for (const e of events) {
        if (e.type === 'run.completed' || RE_STATUS_COMPLETED.test(e.type))
            hasCompleted = true;
        if (e.type === 'run.failed' || RE_STATUS_FAILED.test(e.type))
            hasFailed = true;
        if (e.type === 'run.cancelled' || RE_STATUS_CANCELLED.test(e.type))
            hasCancelled = true;
        if (e.type === 'run.created' || RE_STATUS_STARTED.test(e.type))
            hasStarted = true;
    }
    const status = hasCompleted ? 'completed' :
        hasCancelled ? 'cancelled' :
            hasFailed ? 'failed' :
                hasStarted ? 'running' :
                    'unknown';
    // ── Timing ────────────────────────────────────────────────────────────────
    const startedAt = events.length > 0 ? events[0].ts : undefined;
    const endedAt = events.length > 0 ? events[events.length - 1].ts : undefined;
    let durationMs;
    if (startedAt !== undefined && endedAt !== undefined) {
        const diff = Date.parse(endedAt) - Date.parse(startedAt);
        durationMs = isNaN(diff) ? undefined : diff;
    }
    // ── Tool aggregation ──────────────────────────────────────────────────────
    const toolMap = new Map();
    let toolCallCount = 0;
    for (const e of events) {
        if (!isToolCallEvent(e))
            continue;
        toolCallCount++;
        const tool = extractTool(e);
        if (tool) {
            const entry = (_d = toolMap.get(tool)) !== null && _d !== void 0 ? _d : { count: 0, totalMs: 0 };
            entry.count++;
            entry.totalMs += extractMs(e);
            toolMap.set(tool, entry);
        }
    }
    /** Sort by count descending; ties broken alphabetically by tool name. */
    const topTools = [...toolMap.entries()]
        .map(([tool, v]) => ({ tool, count: v.count, totalMs: v.totalMs }))
        .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
        .slice(0, topToolsLimit);
    // ── Errors ────────────────────────────────────────────────────────────────
    const errorEvents = events.filter(isErrorEvent);
    const errorCount = errorEvents.length;
    const notableErrors = errorEvents
        .slice(-notableErrorsLimit)
        .map(e => ({ ts: e.ts, message: extractErrorMessage(e) }));
    // ── Permission denials ────────────────────────────────────────────────────
    const permissionDeniedCount = events.filter(isPermissionDeniedEvent).length;
    // ── Final text preview ────────────────────────────────────────────────────
    let finalTextPreview;
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (!RE_ASSISTANT_MSG.test(e.type))
            continue;
        const raw = asRaw(e);
        const data = raw['data'];
        const text = (_g = (_f = (_e = data === null || data === void 0 ? void 0 : data['text']) !== null && _e !== void 0 ? _e : data === null || data === void 0 ? void 0 : data['content']) !== null && _f !== void 0 ? _f : raw['text']) !== null && _g !== void 0 ? _g : raw['content'];
        if (typeof text === 'string') {
            finalTextPreview = truncate(text, FINAL_TEXT_PREVIEW_LEN);
        }
        break;
    }
    return {
        runId,
        status,
        startedAt,
        endedAt,
        durationMs,
        toolCallCount,
        topTools,
        errorCount,
        permissionDeniedCount,
        finalTextPreview,
        notableErrors,
    };
}
/**
 * Generate 3–7 short highlight bullet strings from aggregated PM output.
 *
 * Bullets are emitted in order; the list is clamped to at most 7 entries.
 * When no runs exist, the returned array is empty.
 */
export function buildHighlights(out) {
    var _a;
    const { overall, runs } = out;
    const highlights = [];
    const totalRuns = runs.length;
    if (totalRuns > 0) {
        highlights.push(`${overall.completed} of ${totalRuns} runs completed`);
    }
    // Aggregate tool counts across all runs to find the globally most-used tool.
    const globalToolCounts = new Map();
    for (const run of runs) {
        for (const t of run.topTools) {
            globalToolCounts.set(t.tool, ((_a = globalToolCounts.get(t.tool)) !== null && _a !== void 0 ? _a : 0) + t.count);
        }
    }
    if (globalToolCounts.size > 0) {
        const [topTool, topCount] = [...globalToolCounts.entries()]
            .sort((a, b) => b[1] - a[1])[0];
        highlights.push(`Most-used tool: ${topTool} (${topCount} calls)`);
    }
    if (overall.totalErrors > 0) {
        highlights.push(`${overall.totalErrors} errors across all runs`);
    }
    const totalPermDenied = runs.reduce((sum, r) => sum + r.permissionDeniedCount, 0);
    if (totalPermDenied > 0) {
        const noun = totalPermDenied === 1 ? 'run' : 'runs';
        highlights.push(`${totalPermDenied} ${noun} blocked on permission`);
    }
    if (overall.avgDurationMs > 0) {
        highlights.push(`Avg run duration: ${Math.round(overall.avgDurationMs)}ms`);
    }
    return highlights.slice(0, 7);
}
// ====== Main entry point ======
/**
 * Run the PM-summarizer pipeline over a batch of LedgerEvents.
 *
 * When `groupByRun` is `false` (default: `true`), all events are treated as a
 * single synthetic run keyed `'__all__'`; individual `run_id` values are
 * ignored.  This is useful for cross-run aggregate views.
 *
 * The returned `PmSummarizerOutput` is fully deterministic given the same
 * input (apart from `generatedAt`).
 */
export function runPmSummarizer(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { events, groupByRun = true, topToolsLimit = DEFAULT_TOP_TOOLS_LIMIT, notableErrorsLimit = DEFAULT_NOTABLE_ERRORS_LIMIT, } = input;
        const runOpts = { topToolsLimit, notableErrorsLimit };
        const runMap = groupByRun
            ? groupEventsByRun(events)
            : new Map([['__all__', events]]);
        const runs = [...runMap.entries()].map(([runId, evts]) => (Object.assign(Object.assign({}, summarizeRun(evts, runOpts)), { runId })));
        // ── Overall aggregates ────────────────────────────────────────────────────
        let completed = 0, failed = 0, running = 0, cancelled = 0;
        let totalToolCalls = 0, totalErrors = 0;
        let durSum = 0, durCount = 0;
        for (const r of runs) {
            if (r.status === 'completed')
                completed++;
            else if (r.status === 'failed')
                failed++;
            else if (r.status === 'running')
                running++;
            else if (r.status === 'cancelled')
                cancelled++;
            totalToolCalls += r.toolCallCount;
            totalErrors += r.errorCount;
            if (r.durationMs !== undefined) {
                durSum += r.durationMs;
                durCount++;
            }
        }
        const avgDurationMs = durCount > 0 ? durSum / durCount : 0;
        const overall = {
            completed,
            failed,
            running,
            cancelled,
            totalToolCalls,
            totalErrors,
            avgDurationMs,
        };
        const highlights = buildHighlights({ overall, runs });
        return {
            generatedAt: new Date().toISOString(),
            totalEvents: events.length,
            totalRuns: runs.length,
            runs,
            overall,
            highlights,
        };
    });
}
// ====== Subagent Spec ======
/**
 * Return the typed-subagent spec descriptor for `pm-summarizer`.
 *
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec() {
    return {
        name: 'pm-summarizer',
        description: 'Consumes a stream of LedgerEvents from one or more agent runs and produces ' +
            'a deterministic Project-Manager-facing summary: what got done, what is blocked, ' +
            'who/what acted, time-on-task, and top issues. No LLM involved — pure ' +
            'aggregation suitable for feeding to an LLM for prose generation.',
        inputSchema: {
            type: 'object',
            required: ['events'],
            properties: {
                events: {
                    type: 'array',
                    items: { type: 'object' },
                    description: 'Array of LedgerEvent objects from one or more agent runs.',
                },
                groupByRun: {
                    type: 'boolean',
                    description: 'Group events by run_id (default: true). ' +
                        'When false, all events are folded into a single "__all__" run.',
                },
                topToolsLimit: {
                    type: 'number',
                    description: 'Maximum number of top tools to include per run summary (default: 5).',
                },
                notableErrorsLimit: {
                    type: 'number',
                    description: 'Maximum number of notable errors to include per run summary (default: 3).',
                },
            },
        },
        outputSchema: {
            type: 'object',
            required: ['generatedAt', 'totalEvents', 'totalRuns', 'runs', 'overall', 'highlights'],
            properties: {
                generatedAt: { type: 'string', format: 'date-time' },
                totalEvents: { type: 'number' },
                totalRuns: { type: 'number' },
                runs: { type: 'array', items: { type: 'object' } },
                overall: {
                    type: 'object',
                    properties: {
                        completed: { type: 'number' },
                        failed: { type: 'number' },
                        running: { type: 'number' },
                        cancelled: { type: 'number' },
                        totalToolCalls: { type: 'number' },
                        totalErrors: { type: 'number' },
                        avgDurationMs: { type: 'number' },
                    },
                },
                highlights: { type: 'array', items: { type: 'string' } },
            },
        },
    };
}
