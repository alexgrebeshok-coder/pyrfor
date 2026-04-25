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
// ── Error ──────────────────────────────────────────────────────────────────
export class CronParseError extends Error {
    constructor(message, fieldIndex) {
        super(message);
        this.fieldIndex = fieldIndex;
        this.name = 'CronParseError';
    }
}
// ── Presets ────────────────────────────────────────────────────────────────
export const CRON_PRESETS = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
};
const FIELDS = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day-of-month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'day-of-week', min: 0, max: 6 },
];
// ── Internal field parser ──────────────────────────────────────────────────
/**
 * Expand one cron field token (e.g. "1-5/2", "step/10", "3") into a Set.
 * Throws CronParseError with fieldIndex on any syntax error.
 */
function expandField(token, def, fieldIndex) {
    const result = new Set();
    // Comma-separated list — split and recurse.
    if (token.includes(',')) {
        for (const part of token.split(',')) {
            for (const v of expandField(part.trim(), def, fieldIndex)) {
                result.add(v);
            }
        }
        return result;
    }
    // Determine range and optional step.
    let lo;
    let hi;
    let step = 1;
    // Separate step suffix.
    const slashIdx = token.indexOf('/');
    let rangeToken;
    if (slashIdx !== -1) {
        rangeToken = token.slice(0, slashIdx);
        const stepStr = token.slice(slashIdx + 1);
        if (!/^\d+$/.test(stepStr)) {
            throw new CronParseError(`Invalid step "${stepStr}" in field ${def.name}`, fieldIndex);
        }
        step = parseInt(stepStr, 10);
        if (step < 1) {
            throw new CronParseError(`Step must be >= 1 in field ${def.name}, got ${step}`, fieldIndex);
        }
    }
    else {
        rangeToken = token;
    }
    if (rangeToken === '*') {
        lo = def.min;
        hi = def.max;
    }
    else if (rangeToken.includes('-')) {
        const parts = rangeToken.split('-');
        if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
            throw new CronParseError(`Invalid range "${rangeToken}" in field ${def.name}`, fieldIndex);
        }
        if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
            throw new CronParseError(`Non-numeric range "${rangeToken}" in field ${def.name}`, fieldIndex);
        }
        lo = parseInt(parts[0], 10);
        hi = parseInt(parts[1], 10);
        if (lo > hi) {
            throw new CronParseError(`Range start ${lo} > end ${hi} in field ${def.name}`, fieldIndex);
        }
    }
    else {
        // Single value.
        if (!/^\d+$/.test(rangeToken)) {
            throw new CronParseError(`Non-numeric value "${rangeToken}" in field ${def.name}`, fieldIndex);
        }
        lo = parseInt(rangeToken, 10);
        hi = lo;
    }
    // Validate bounds.
    if (lo < def.min || hi > def.max) {
        throw new CronParseError(`Value out of range [${def.min}-${def.max}] in field ${def.name}: ${lo}-${hi}`, fieldIndex);
    }
    for (let v = lo; v <= hi; v += step) {
        result.add(v);
    }
    return result;
}
// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Parse a 5-field cron expression (or preset) into a CronSchedule.
 * Throws CronParseError on syntax errors.
 */
export function parseCron(expr) {
    var _a;
    const trimmed = expr.trim();
    // Expand preset aliases.
    const resolved = (_a = CRON_PRESETS[trimmed]) !== null && _a !== void 0 ? _a : trimmed;
    const parts = resolved.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new CronParseError(`Expected 5 fields, got ${parts.length}: "${resolved}"`);
    }
    const sets = parts.map((token, i) => expandField(token, FIELDS[i], i));
    return {
        minutes: sets[0],
        hours: sets[1],
        dom: sets[2],
        months: sets[3],
        dow: sets[4],
        originalDomStar: parts[2] === '*',
        originalDowStar: parts[4] === '*',
        raw: expr,
    };
}
/**
 * Test whether an epoch-ms timestamp satisfies a parsed schedule.
 * DOM/DOW Vixie semantics: if BOTH dom and dow were explicitly set, match
 * on EITHER; otherwise strict AND.
 */
export function matches(schedule, ms) {
    const d = new Date(ms);
    const min = d.getUTCMinutes();
    const hour = d.getUTCHours();
    const date = d.getUTCDate(); // 1-31
    const month = d.getUTCMonth() + 1; // 1-12
    const day = d.getUTCDay(); // 0-6
    if (!schedule.minutes.has(min))
        return false;
    if (!schedule.hours.has(hour))
        return false;
    if (!schedule.months.has(month))
        return false;
    // Vixie DOM/DOW logic.
    const domOk = schedule.dom.has(date);
    const dowOk = schedule.dow.has(day);
    if (!schedule.originalDomStar && !schedule.originalDowStar) {
        // Both explicitly specified → OR.
        return domOk || dowOk;
    }
    // Default AND (one or both wildcards → normal matching).
    return domOk && dowOk;
}
/**
 * Return the next epoch-ms strictly greater than `fromMs` that satisfies
 * the schedule.  Iterates minute-by-minute up to 4 years (~2.1M iterations).
 * Throws CronParseError if no match is found within the window.
 */
export function nextRun(schedule, fromMs, _opts) {
    // Align to the start of the next minute (seconds/ms zeroed).
    const startMs = Math.floor(fromMs / 60000) * 60000 + 60000;
    // 4 years of minutes (leap-year safe).
    const MAX_MINUTES = 4 * 366 * 24 * 60; // 2_104_704
    for (let i = 0; i < MAX_MINUTES; i++) {
        const candidate = startMs + i * 60000;
        if (matches(schedule, candidate)) {
            return candidate;
        }
    }
    throw new CronParseError(`No occurrence found within 4 years for schedule "${schedule.raw}"`);
}
