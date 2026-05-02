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
export interface RunSummary {
    runId: string;
    status: 'completed' | 'failed' | 'running' | 'cancelled' | 'unknown';
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    toolCallCount: number;
    /** Top N tools by call count; ties broken alphabetically. */
    topTools: Array<{
        tool: string;
        count: number;
        totalMs: number;
    }>;
    errorCount: number;
    permissionDeniedCount: number;
    /** First 240 chars of the last assistant-message event's text, if found. */
    finalTextPreview?: string;
    /** Up to N most-recent error events with extracted messages. */
    notableErrors: Array<{
        ts: string;
        message: string;
    }>;
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
/**
 * Group a flat array of LedgerEvents into a Map keyed by run_id.
 *
 * Events whose `run_id` is absent or empty are collected under the special
 * bucket key `'__unknown__'`.  Within each bucket events remain in their
 * original order.
 */
export declare function groupEventsByRun(events: LedgerEvent[]): Map<string, LedgerEvent[]>;
/**
 * Produce a RunSummary for a homogenous slice of events belonging to one run.
 *
 * `runId` is inferred from the first event's `run_id`; callers may override
 * via the returned value after this call.  `opts` controls output limits.
 */
export declare function summarizeRun(events: LedgerEvent[], opts?: {
    topToolsLimit?: number;
    notableErrorsLimit?: number;
}): RunSummary;
/**
 * Generate 3–7 short highlight bullet strings from aggregated PM output.
 *
 * Bullets are emitted in order; the list is clamped to at most 7 entries.
 * When no runs exist, the returned array is empty.
 */
export declare function buildHighlights(out: Pick<PmSummarizerOutput, 'overall' | 'runs'>): string[];
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
export declare function runPmSummarizer(input: PmSummarizerInput): Promise<PmSummarizerOutput>;
/**
 * Return the typed-subagent spec descriptor for `pm-summarizer`.
 *
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export declare function subagentSpec(): {
    name: 'pm-summarizer';
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
};
//# sourceMappingURL=pm-summarizer.d.ts.map