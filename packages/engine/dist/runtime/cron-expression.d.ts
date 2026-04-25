/**
 * Pyrfor Runtime — CronExpression
 *
 * Zero-dependency 5-field cron expression parser + nextRun calculator.
 *
 * FIELD ORDER: minute hour day-of-month month day-of-week
 * RANGES:      min(0-59) hour(0-23) dom(1-31) month(1-12) dow(0-6, 0=Sun)
 *
 * SYNTAX PER FIELD:
 *   *        — all values
 *   n        — single value
 *   n-m      — inclusive range
 *   *‌/k      — step over full range
 *   n-m/k    — step over range
 *   a,b,...  — comma-separated list of any of the above
 *
 * DOM/DOW SEMANTICS (Vixie cron):
 *   - If the user specifies BOTH dom and dow (neither is raw "*"), a timestamp
 *     matches when EITHER the dom condition OR the dow condition is true.
 *   - If only one side is specified, normal AND logic applies.
 *   originalDomStar / originalDowStar track which fields were literally "*".
 *
 * ITERATION STRATEGY:
 *   nextRun walks forward one minute at a time from (fromMs + 1 min).
 *   4 years ≈ 2,102,400 minutes — acceptable for a scheduler that runs
 *   infrequently and whose hot path is cache-hit on the persisted nextRunMs.
 */
export declare class CronParseError extends Error {
    readonly fieldIndex?: number | undefined;
    constructor(message: string, fieldIndex?: number | undefined);
}
export interface CronSchedule {
    minutes: Set<number>;
    hours: Set<number>;
    dom: Set<number>;
    months: Set<number>;
    dow: Set<number>;
    /** True when the dom field was literally "*" (no explicit dom constraint). */
    originalDomStar: boolean;
    /** True when the dow field was literally "*" (no explicit dow constraint). */
    originalDowStar: boolean;
    raw: string;
}
export interface NextRunOptions {
    tz?: 'utc';
}
export declare const CRON_PRESETS: Record<string, string>;
/**
 * Parse a 5-field cron expression (or preset) into a CronSchedule.
 * Throws CronParseError on syntax errors.
 */
export declare function parseCron(expr: string): CronSchedule;
/**
 * Test whether an epoch-ms timestamp satisfies a parsed schedule.
 * DOM/DOW Vixie semantics: if BOTH dom and dow were explicitly set, match
 * on EITHER; otherwise strict AND.
 */
export declare function matches(schedule: CronSchedule, ms: number): boolean;
/**
 * Return the next epoch-ms strictly greater than `fromMs` that satisfies
 * the schedule.  Iterates minute-by-minute up to 4 years (~2.1M iterations).
 * Throws CronParseError if no match is found within the window.
 */
export declare function nextRun(schedule: CronSchedule, fromMs: number, _opts?: NextRunOptions): number;
//# sourceMappingURL=cron-expression.d.ts.map