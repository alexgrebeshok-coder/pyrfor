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

import type { LedgerEvent } from '../runtime/event-ledger.js';

// ====== Interfaces ======

export interface RunSummary {
  runId: string;
  status: 'completed' | 'failed' | 'running' | 'cancelled' | 'unknown';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  toolCallCount: number;
  /** Top N tools by call count; ties broken alphabetically. */
  topTools: Array<{ tool: string; count: number; totalMs: number }>;
  errorCount: number;
  permissionDeniedCount: number;
  /** First 240 chars of the last assistant-message event's text, if found. */
  finalTextPreview?: string;
  /** Up to N most-recent error events with extracted messages. */
  notableErrors: Array<{ ts: string; message: string }>;
}

export interface PmSummarizerInput {
  events: LedgerEvent[];
  /** When true (default) events are grouped by run_id; false folds all into '__all__'. */
  groupByRun?: boolean;
  /** Max tools to include per run. Default 5. */
  topToolsLimit?: number;
  /** Max notable errors to include per run. Default 3. */
  notableErrorsLimit?: number;
}

export interface PmSummarizerOutput {
  /** ISO 8601 timestamp when this summary was generated. */
  generatedAt: string;
  totalEvents: number;
  totalRuns: number;
  runs: RunSummary[];
  overall: {
    completed: number;
    failed: number;
    running: number;
    cancelled: number;
    totalToolCalls: number;
    totalErrors: number;
    /** Arithmetic mean over runs that have both a start and end timestamp. */
    avgDurationMs: number;
  };
  /** 3–7 short human-readable bullet strings for a PM dashboard. */
  highlights: string[];
}

// ====== Constants ======

const DEFAULT_TOP_TOOLS_LIMIT   = 5;
const DEFAULT_NOTABLE_ERRORS_LIMIT = 3;
const FINAL_TEXT_PREVIEW_LEN    = 240;
/** Bucket key used for events that carry no run_id. */
const UNKNOWN_RUN_ID = '__unknown__';

// ====== Regex helpers ======

/** Matches event types that represent a completed/finished run. */
const RE_STATUS_COMPLETED  = /run.?completed|run.?finished|completed/i;
/** Matches event types that represent a failed run or generic error state. */
const RE_STATUS_FAILED     = /run.?failed/i;
/** Matches event types that represent a cancelled or aborted run. */
const RE_STATUS_CANCELLED  = /cancel|abort/i;
/** Matches event types indicating a run has been initiated. */
const RE_STATUS_STARTED    = /run.?creat|run.?start/i;
/** Matches event types / levels that indicate an error condition. */
const RE_ERROR_TYPE        = /error/i;
/** Matches event types associated with a permission or approval check. */
const RE_PERMISSION        = /permission/i;
/** Matches event types that carry an assistant / model text payload. */
const RE_ASSISTANT_MSG     = /assistant.?message|final.?text/i;
/** Matches event types representing a tool invocation or execution. */
const RE_TOOL_CALL         = /tool.?(call|exec)/i;

// ====== Pure field-extraction helpers ======

/**
 * Coerce an event to a plain key/value bag for defensive field access.
 * Avoids spreading the discriminated-union type throughout the module.
 */
function asRaw(e: LedgerEvent): Record<string, unknown> {
  return e as unknown as Record<string, unknown>;
}

/**
 * Extract a tool name from an event.
 * Checks top-level `tool` first, then `data.tool` as a defensive fallback.
 */
function extractTool(e: LedgerEvent): string | undefined {
  const raw = asRaw(e);
  const top = raw['tool'];
  if (typeof top === 'string' && top) return top;
  const data = raw['data'] as Record<string, unknown> | undefined;
  const nested = data?.['tool'];
  if (typeof nested === 'string' && nested) return nested;
  return undefined;
}

/**
 * Extract a duration value (ms) from an event.
 * Checks top-level `ms` first, then `data.durationMs` as a fallback.
 */
function extractMs(e: LedgerEvent): number {
  const raw = asRaw(e);
  const top = raw['ms'];
  if (typeof top === 'number') return top;
  const data = raw['data'] as Record<string, unknown> | undefined;
  const nested = data?.['durationMs'];
  if (typeof nested === 'number') return nested;
  return 0;
}

/**
 * Return true when the event represents a tool call or execution.
 * Matches type against RE_TOOL_CALL, or falls back to the presence of a `tool`
 * field (handles future event shapes defensively).
 */
function isToolCallEvent(e: LedgerEvent): boolean {
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
function isErrorEvent(e: LedgerEvent): boolean {
  if (e.type === 'run.failed') return true;
  if (RE_ERROR_TYPE.test(e.type)) return true;
  const raw = asRaw(e);
  if (raw['error']) return true;
  const data = raw['data'] as Record<string, unknown> | undefined;
  if (data?.['error']) return true;
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
function isPermissionDeniedEvent(e: LedgerEvent): boolean {
  if (e.type === 'approval.denied' || e.type === 'tool.denied') return true;
  if (RE_PERMISSION.test(e.type)) {
    const raw = asRaw(e);
    const data = raw['data'] as Record<string, unknown> | undefined;
    if (
      data?.['outcome'] === 'denied' ||
      data?.['allowed'] === false      ||
      raw['allowed']    === false
    ) return true;
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
function extractErrorMessage(e: LedgerEvent): string {
  const raw  = asRaw(e);
  const data = raw['data'] as Record<string, unknown> | undefined;

  // data.error (object or string)
  const dataErr = data?.['error'];
  if (dataErr && typeof dataErr === 'object') {
    const m = (dataErr as Record<string, unknown>)['message'];
    if (typeof m === 'string' && m) return m;
  }
  if (typeof dataErr === 'string' && dataErr) return dataErr;

  // top-level error (object or string)
  const topErr = raw['error'];
  if (topErr && typeof topErr === 'object') {
    const m = (topErr as Record<string, unknown>)['message'];
    if (typeof m === 'string' && m) return m;
  }
  if (typeof topErr === 'string' && topErr) return topErr;

  // fallback message fields
  const dataMsg = data?.['message'];
  if (typeof dataMsg === 'string' && dataMsg) return dataMsg;
  const topMsg = raw['message'];
  if (typeof topMsg === 'string' && topMsg) return topMsg;

  return 'unknown error';
}

/**
 * Truncate `s` to at most `maxLen` characters, appending "…" when truncated.
 */
function truncate(s: string, maxLen: number): string {
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
export function groupEventsByRun(events: LedgerEvent[]): Map<string, LedgerEvent[]> {
  const map = new Map<string, LedgerEvent[]>();
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
export function summarizeRun(
  events: LedgerEvent[],
  opts?: { topToolsLimit?: number; notableErrorsLimit?: number },
): RunSummary {
  const topToolsLimit      = opts?.topToolsLimit      ?? DEFAULT_TOP_TOOLS_LIMIT;
  const notableErrorsLimit = opts?.notableErrorsLimit ?? DEFAULT_NOTABLE_ERRORS_LIMIT;

  const runId = (events[0]?.run_id) || UNKNOWN_RUN_ID;

  // ── Status detection ──────────────────────────────────────────────────────

  let hasCompleted = false;
  let hasFailed    = false;
  let hasCancelled = false;
  let hasStarted   = false;

  for (const e of events) {
    if (e.type === 'run.completed' || RE_STATUS_COMPLETED.test(e.type)) hasCompleted = true;
    if (e.type === 'run.failed'    || RE_STATUS_FAILED.test(e.type))    hasFailed    = true;
    if (e.type === 'run.cancelled' || RE_STATUS_CANCELLED.test(e.type)) hasCancelled = true;
    if (e.type === 'run.created'   || RE_STATUS_STARTED.test(e.type))   hasStarted   = true;
  }

  const status: RunSummary['status'] =
    hasCompleted ? 'completed' :
    hasCancelled ? 'cancelled' :
    hasFailed    ? 'failed'    :
    hasStarted   ? 'running'   :
    'unknown';

  // ── Timing ────────────────────────────────────────────────────────────────

  const startedAt = events.length > 0 ? events[0].ts               : undefined;
  const endedAt   = events.length > 0 ? events[events.length - 1].ts : undefined;

  let durationMs: number | undefined;
  if (startedAt !== undefined && endedAt !== undefined) {
    const diff = Date.parse(endedAt) - Date.parse(startedAt);
    durationMs = isNaN(diff) ? undefined : diff;
  }

  // ── Tool aggregation ──────────────────────────────────────────────────────

  const toolMap = new Map<string, { count: number; totalMs: number }>();
  let toolCallCount = 0;

  for (const e of events) {
    if (!isToolCallEvent(e)) continue;
    toolCallCount++;
    const tool = extractTool(e);
    if (tool) {
      const entry = toolMap.get(tool) ?? { count: 0, totalMs: 0 };
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
  const errorCount  = errorEvents.length;

  const notableErrors = errorEvents
    .slice(-notableErrorsLimit)
    .map(e => ({ ts: e.ts, message: extractErrorMessage(e) }));

  // ── Permission denials ────────────────────────────────────────────────────

  const permissionDeniedCount = events.filter(isPermissionDeniedEvent).length;

  // ── Final text preview ────────────────────────────────────────────────────

  let finalTextPreview: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!RE_ASSISTANT_MSG.test(e.type)) continue;
    const raw  = asRaw(e);
    const data = raw['data'] as Record<string, unknown> | undefined;
    const text = data?.['text'] ?? data?.['content'] ?? raw['text'] ?? raw['content'];
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
export function buildHighlights(
  out: Pick<PmSummarizerOutput, 'overall' | 'runs'>,
): string[] {
  const { overall, runs } = out;
  const highlights: string[] = [];
  const totalRuns = runs.length;

  if (totalRuns > 0) {
    highlights.push(`${overall.completed} of ${totalRuns} runs completed`);
  }

  // Aggregate tool counts across all runs to find the globally most-used tool.
  const globalToolCounts = new Map<string, number>();
  for (const run of runs) {
    for (const t of run.topTools) {
      globalToolCounts.set(t.tool, (globalToolCounts.get(t.tool) ?? 0) + t.count);
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
export async function runPmSummarizer(
  input: PmSummarizerInput,
): Promise<PmSummarizerOutput> {
  const {
    events,
    groupByRun        = true,
    topToolsLimit     = DEFAULT_TOP_TOOLS_LIMIT,
    notableErrorsLimit = DEFAULT_NOTABLE_ERRORS_LIMIT,
  } = input;

  const runOpts = { topToolsLimit, notableErrorsLimit };

  const runMap: Map<string, LedgerEvent[]> = groupByRun
    ? groupEventsByRun(events)
    : new Map([['__all__', events]]);

  const runs: RunSummary[] = [...runMap.entries()].map(([runId, evts]) => ({
    ...summarizeRun(evts, runOpts),
    runId,   // ensure the map key is authoritative (handles '__all__' override)
  }));

  // ── Overall aggregates ────────────────────────────────────────────────────

  let completed = 0, failed = 0, running = 0, cancelled = 0;
  let totalToolCalls = 0, totalErrors = 0;
  let durSum = 0, durCount = 0;

  for (const r of runs) {
    if      (r.status === 'completed') completed++;
    else if (r.status === 'failed')    failed++;
    else if (r.status === 'running')   running++;
    else if (r.status === 'cancelled') cancelled++;

    totalToolCalls += r.toolCallCount;
    totalErrors    += r.errorCount;

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
    totalRuns:   runs.length,
    runs,
    overall,
    highlights,
  };
}

// ====== Subagent Spec ======

/**
 * Return the typed-subagent spec descriptor for `pm-summarizer`.
 *
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec(): {
  name: 'pm-summarizer';
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
} {
  return {
    name: 'pm-summarizer',
    description:
      'Consumes a stream of LedgerEvents from one or more agent runs and produces ' +
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
          description:
            'Group events by run_id (default: true). ' +
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
        totalRuns:   { type: 'number' },
        runs:        { type: 'array', items: { type: 'object' } },
        overall: {
          type: 'object',
          properties: {
            completed:      { type: 'number' },
            failed:         { type: 'number' },
            running:        { type: 'number' },
            cancelled:      { type: 'number' },
            totalToolCalls: { type: 'number' },
            totalErrors:    { type: 'number' },
            avgDurationMs:  { type: 'number' },
          },
        },
        highlights: { type: 'array', items: { type: 'string' } },
      },
    },
  };
}
