/**
 * cron-builder — Fluent builder + parser + scheduler for 5/6-field cron
 * expressions. Zero external dependencies; Node built-ins only.
 *
 * 5-field format:  minute hour day-of-month month day-of-week
 * 6-field format:  second minute hour day-of-month month day-of-week
 *
 * FIELD RANGES
 *   second       0–59   (6-field only)
 *   minute       0–59
 *   hour         0–23
 *   day-of-month 1–31
 *   month        1–12   (jan=1 … dec=12)
 *   day-of-week  0–6    (0=Sun, 1=Mon … 6=Sat; sun/mon/… names accepted)
 *
 * SPECIAL SYNTAX
 *   *        all values
 *   n        single value
 *   n-m      inclusive range
 *   *\/k      every k-th value (step over full range)
 *   n-m/k    step over a range
 *   a,b,…   comma-separated list (any mix of the above)
 *   L        last day of month (dom field only)
 *   d#n      n-th occurrence of weekday d  e.g. "2#3" = 3rd Tuesday
 *
 * ALIAS PRESETS
 *   @yearly / @annually  →  0 0 1 1 *
 *   @monthly             →  0 0 1 * *
 *   @weekly              →  0 0 * * 0
 *   @daily / @midnight   →  0 0 * * *
 *   @hourly              →  0 * * * *
 *
 * DOM / DOW SEMANTICS (Vixie cron)
 *   When BOTH dom and dow are explicitly constrained (neither is a bare "*"),
 *   a timestamp matches when EITHER the dom OR the dow condition is true.
 *   If only one side is constrained, normal AND logic applies.
 *
 * DST NOTE
 *   All scheduling uses the host's local time (getHours / getDate / etc.).
 *   DST transitions are not handled: a spring-forward may skip one occurrence;
 *   a fall-back may fire twice. For DST-safe scheduling run under TZ=UTC.
 */

// ── Error ──────────────────────────────────────────────────────────────────

export class CronParseError extends Error {
  constructor(message: string, public readonly fieldIndex?: number) {
    super(message);
    this.name = 'CronParseError';
  }
}

// ── Public types ───────────────────────────────────────────────────────────

/** Describes a `d#n` dow token (n-th occurrence of a weekday in the month). */
export interface NthWeekday {
  /** Day-of-week 0 = Sun … 6 = Sat. */
  dow: number;
  /** 1-indexed occurrence within the month (1 = first … 5 = fifth). */
  n: number;
}

/** Parsed representation of a cron expression. */
export interface CronSpec {
  /** Seconds set (0–59). Populated only when withSeconds is true. */
  seconds: Set<number>;
  /** Minutes set (0–59). */
  minutes: Set<number>;
  /** Hours set (0–23). */
  hours: Set<number>;
  /** Day-of-month set (1–31). Empty when lastDom is true. */
  dom: Set<number>;
  /** Months set (1–12). */
  months: Set<number>;
  /** Day-of-week set (0–6). Empty when nthWeekday is non-null. */
  dow: Set<number>;
  /** True when dom field was `L` (last calendar day of the month). */
  lastDom: boolean;
  /** Non-null when dow field uses the `d#n` nth-weekday syntax. */
  nthWeekday: NthWeekday | null;
  /** True when dom field was a bare `*` (no explicit dom restriction). */
  originalDomStar: boolean;
  /** True when dow field was a bare `*` (no explicit dow restriction). */
  originalDowStar: boolean;
  /** True when the expression was parsed as a 6-field (seconds present). */
  withSeconds: boolean;
  /** Original expression string passed to parseCron. */
  raw: string;
}

/** Field names accepted by CronBuilder.between(). */
export type BetweenField =
  | 'second'
  | 'minute'
  | 'hour'
  | 'dom'
  | 'month'
  | 'dow';

// ── Internal constants ─────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly':  '0 0 1 * *',
  '@weekly':   '0 0 * * 0',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly':   '0 * * * *',
};

const MONTH_NAMES_MAP: Record<string, string> = {
  jan: '1',  feb: '2',  mar: '3',  apr: '4',  may: '5',  jun: '6',
  jul: '7',  aug: '8',  sep: '9',  oct: '10', nov: '11', dec: '12',
};

const DOW_NAMES_MAP: Record<string, string> = {
  sun: '0', mon: '1', tue: '2', wed: '3', thu: '4', fri: '5', sat: '6',
};

interface FieldDef { name: string; min: number; max: number }

const SEC_DEF:   FieldDef = { name: 'second',       min: 0,  max: 59 };
const MIN_DEF:   FieldDef = { name: 'minute',       min: 0,  max: 59 };
const HOUR_DEF:  FieldDef = { name: 'hour',         min: 0,  max: 23 };
const DOM_DEF:   FieldDef = { name: 'day-of-month', min: 1,  max: 31 };
const MONTH_DEF: FieldDef = { name: 'month',        min: 1,  max: 12 };
const DOW_DEF:   FieldDef = { name: 'day-of-week',  min: 0,  max: 6  };

/** 4-year iteration cap using an upper-bound of 366 days/year. */
const MAX_MINUTES = 4 * 366 * 24 * 60; // ≈ 2.1 M

// ── Field expander ─────────────────────────────────────────────────────────

/**
 * Expand one cron field token into a Set<number>.
 * Handles: `*`, single value, range `n-m`, step `*\/k` / `n-m/k`,
 * and comma-separated lists of any of the above.
 */
function expandField(
  token: string,
  def: FieldDef,
  fieldIdx: number,
): Set<number> {
  const result = new Set<number>();

  if (token.includes(',')) {
    for (const part of token.split(',')) {
      for (const v of expandField(part.trim(), def, fieldIdx)) result.add(v);
    }
    return result;
  }

  let lo: number;
  let hi: number;
  let step = 1;

  const slashIdx = token.indexOf('/');
  let rangeToken: string;

  if (slashIdx !== -1) {
    rangeToken = token.slice(0, slashIdx);
    const stepStr = token.slice(slashIdx + 1);
    if (!/^\d+$/.test(stepStr)) {
      throw new CronParseError(
        `Invalid step "${stepStr}" in field ${def.name}`,
        fieldIdx,
      );
    }
    step = parseInt(stepStr, 10);
    if (step < 1) {
      throw new CronParseError(
        `Step must be >= 1 in field ${def.name}, got ${step}`,
        fieldIdx,
      );
    }
  } else {
    rangeToken = token;
  }

  if (rangeToken === '*') {
    lo = def.min;
    hi = def.max;
  } else if (rangeToken.includes('-')) {
    const dashIdx = rangeToken.indexOf('-');
    const loStr = rangeToken.slice(0, dashIdx);
    const hiStr = rangeToken.slice(dashIdx + 1);
    if (!/^\d+$/.test(loStr) || !/^\d+$/.test(hiStr)) {
      throw new CronParseError(
        `Non-numeric range "${rangeToken}" in field ${def.name}`,
        fieldIdx,
      );
    }
    lo = parseInt(loStr, 10);
    hi = parseInt(hiStr, 10);
    if (lo > hi) {
      throw new CronParseError(
        `Range start ${lo} > end ${hi} in field ${def.name}`,
        fieldIdx,
      );
    }
  } else {
    if (!/^\d+$/.test(rangeToken)) {
      throw new CronParseError(
        `Non-numeric value "${rangeToken}" in field ${def.name}`,
        fieldIdx,
      );
    }
    lo = parseInt(rangeToken, 10);
    hi = lo;
  }

  if (lo < def.min || hi > def.max) {
    throw new CronParseError(
      `Value out of range [${def.min}-${def.max}] in field ${def.name}: ${lo}-${hi}`,
      fieldIdx,
    );
  }

  for (let v = lo; v <= hi; v += step) result.add(v);
  return result;
}

// ── Name-alias normaliser ──────────────────────────────────────────────────

function replaceNames(token: string, map: Record<string, string>): string {
  const pattern = new RegExp(`\\b(${Object.keys(map).join('|')})\\b`, 'gi');
  return token.replace(pattern, (m) => map[m.toLowerCase()] ?? m);
}

// ── Specialised dom / dow parsers ──────────────────────────────────────────

function parseDomToken(
  token: string,
  idx: number,
): { set: Set<number>; lastDom: boolean } {
  if (token === 'L') return { set: new Set(), lastDom: true };
  return { set: expandField(token, DOM_DEF, idx), lastDom: false };
}

function parseDowToken(
  token: string,
  idx: number,
): { set: Set<number>; nthWeekday: NthWeekday | null } {
  const hashIdx = token.indexOf('#');
  if (hashIdx !== -1) {
    const dowRaw = replaceNames(token.slice(0, hashIdx), DOW_NAMES_MAP);
    const nStr   = token.slice(hashIdx + 1);
    if (!/^\d+$/.test(dowRaw) || !/^\d+$/.test(nStr)) {
      throw new CronParseError(`Invalid #n syntax "${token}"`, idx);
    }
    const dow = parseInt(dowRaw, 10);
    const n   = parseInt(nStr,   10);
    if (dow < DOW_DEF.min || dow > DOW_DEF.max) {
      throw new CronParseError(
        `Day-of-week ${dow} out of range [${DOW_DEF.min}-${DOW_DEF.max}]`,
        idx,
      );
    }
    if (n < 1 || n > 5) {
      throw new CronParseError(`Occurrence ${n} in #n out of range [1-5]`, idx);
    }
    return { set: new Set(), nthWeekday: { dow, n } };
  }

  const normalized = replaceNames(token, DOW_NAMES_MAP);
  return { set: expandField(normalized, DOW_DEF, idx), nthWeekday: null };
}

// ── Public: parseCron ──────────────────────────────────────────────────────

/**
 * Parse a 5- or 6-field cron expression (or @alias) into a CronSpec.
 *
 * @param expr     - cron string, e.g. `"0 14 * * *"` or `"@daily"`
 * @param opts     - `{ withSeconds: true }` to parse 6-field (sec min hr dom mon dow)
 * @throws CronParseError on any syntax error
 */
export function parseCron(
  expr: string,
  opts: { withSeconds?: boolean } = {},
): CronSpec {
  const { withSeconds = false } = opts;
  const trimmed = expr.trim();

  const alias = ALIASES[trimmed];
  const resolved =
    alias !== undefined
      ? withSeconds ? `0 ${alias}` : alias
      : trimmed;

  const parts    = resolved.trim().split(/\s+/);
  const expected = withSeconds ? 6 : 5;

  if (parts.length !== expected) {
    throw new CronParseError(
      `Expected ${expected} fields, got ${parts.length}: "${resolved}"`,
    );
  }

  let secToken: string;
  let minToken: string;
  let hourToken: string;
  let domToken: string;
  let monthToken: string;
  let dowToken: string;

  if (withSeconds) {
    secToken   = parts[0];
    minToken   = parts[1];
    hourToken  = parts[2];
    domToken   = parts[3];
    monthToken = parts[4];
    dowToken   = parts[5];
  } else {
    secToken   = '';      // not used
    minToken   = parts[0];
    hourToken  = parts[1];
    domToken   = parts[2];
    monthToken = parts[3];
    dowToken   = parts[4];
  }

  // Field-index offset for error messages (0-based within the expression).
  const base = withSeconds ? 0 : -1;

  const seconds = withSeconds
    ? expandField(secToken, SEC_DEF, 0)
    : new Set<number>();

  const minutes = expandField(minToken, MIN_DEF, base + 1);
  const hours   = expandField(hourToken, HOUR_DEF, base + 2);

  const { set: dom, lastDom } = parseDomToken(domToken, base + 3);
  const months = expandField(
    replaceNames(monthToken, MONTH_NAMES_MAP),
    MONTH_DEF,
    base + 4,
  );
  const { set: dow, nthWeekday } = parseDowToken(dowToken, base + 5);

  return {
    seconds,
    minutes,
    hours,
    dom,
    months,
    dow,
    lastDom,
    nthWeekday,
    originalDomStar: domToken === '*',
    originalDowStar: dowToken === '*',
    withSeconds,
    raw: expr,
  };
}

// ── Public: matches ────────────────────────────────────────────────────────

/**
 * Test whether a Date satisfies a CronSpec.
 *
 * Uses local time. Vixie OR semantics are applied to dom/dow when both were
 * explicitly specified (neither was a bare `*`).
 */
export function matches(spec: CronSpec, date: Date): boolean {
  if (spec.withSeconds && !spec.seconds.has(date.getSeconds())) return false;
  if (!spec.minutes.has(date.getMinutes()))  return false;
  if (!spec.hours.has(date.getHours()))      return false;
  if (!spec.months.has(date.getMonth() + 1)) return false;

  // ── DOM check ────────────────────────────────────────────────────────────
  let domOk: boolean;
  if (spec.lastDom) {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    domOk = date.getDate() === lastDay;
  } else {
    domOk = spec.dom.has(date.getDate());
  }

  // ── DOW check ────────────────────────────────────────────────────────────
  let dowOk: boolean;
  if (spec.nthWeekday !== null) {
    const { dow: targetDow, n } = spec.nthWeekday;
    if (date.getDay() !== targetDow) {
      dowOk = false;
    } else {
      // Occurrence = ceiling(dayOfMonth / 7).
      dowOk = Math.ceil(date.getDate() / 7) === n;
    }
  } else {
    dowOk = spec.dow.has(date.getDay());
  }

  // ── Vixie OR semantics ───────────────────────────────────────────────────
  if (!spec.originalDomStar && !spec.originalDowStar) {
    return domOk || dowOk;
  }
  return domOk && dowOk;
}

// ── Public: nextRun ────────────────────────────────────────────────────────

/**
 * Return the next Date strictly after `fromDate` that satisfies `spec`.
 *
 * For 5-field specs iterates minute-by-minute; for 6-field iterates
 * minute-by-minute and checks matching seconds within each minute —
 * O(~2.1 M minutes) in either case.
 *
 * Returns `null` when no occurrence is found within a 4-year window
 * (e.g. "0 0 30 2 *" — 30 Feb never exists).
 */
export function nextRun(spec: CronSpec, fromDate: Date): Date | null {
  const fromMs = fromDate.getTime();

  if (spec.withSeconds) {
    const startSec = Math.floor(fromMs / 1_000) + 1;
    const startMin = Math.floor(startSec / 60);
    const sortedSecs = [...spec.seconds].sort((a, b) => a - b);

    for (let mi = 0; mi < MAX_MINUTES; mi++) {
      const minMs = (startMin + mi) * 60_000;
      for (const s of sortedSecs) {
        const candidateMs = minMs + s * 1_000;
        if (candidateMs <= fromMs) continue;
        const candidate = new Date(candidateMs);
        if (matches(spec, candidate)) return candidate;
      }
    }
    return null;
  }

  const startMs = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < MAX_MINUTES; i++) {
    const candidate = new Date(startMs + i * 60_000);
    if (matches(spec, candidate)) return candidate;
  }
  return null;
}

// ── Public: prevRun ────────────────────────────────────────────────────────

/**
 * Return the most recent Date strictly before `fromDate` that satisfies `spec`.
 *
 * Returns `null` when no occurrence is found within a 4-year lookback window.
 */
export function prevRun(spec: CronSpec, fromDate: Date): Date | null {
  const fromMs = fromDate.getTime();

  if (spec.withSeconds) {
    const startSec = Math.floor((fromMs - 1) / 1_000);
    const startMin = Math.floor(startSec / 60);
    const sortedSecs = [...spec.seconds].sort((a, b) => b - a);

    for (let mi = 0; mi < MAX_MINUTES; mi++) {
      const minMs = (startMin - mi) * 60_000;
      for (const s of sortedSecs) {
        const candidateMs = minMs + s * 1_000;
        if (candidateMs >= fromMs) continue;
        const candidate = new Date(candidateMs);
        if (matches(spec, candidate)) return candidate;
      }
    }
    return null;
  }

  const startMs = Math.floor((fromMs - 1) / 60_000) * 60_000;
  for (let i = 0; i < MAX_MINUTES; i++) {
    const candidate = new Date(startMs - i * 60_000);
    if (matches(spec, candidate)) return candidate;
  }
  return null;
}

// ── Fluent builder ─────────────────────────────────────────────────────────

/**
 * Fluent cron-expression builder.
 *
 * @example
 * cron().daily().at('14:30').toString()  // "30 14 * * *"
 * cron().weekly().onWeekdays('mon').toString()  // "0 0 * * 1"
 * cron().everyN({ minute: 15 }).toString()  // every-15-minutes expression
 */
export class CronBuilder {
  private sec    = '0';
  private min    = '*';
  private hour   = '*';
  private dom_   = '*';
  private month_ = '*';
  private dow_   = '*';
  private _withSeconds = false;

  /** Fire every minute: `* * * * *` */
  everyMinute(): this {
    this.min = '*'; this.hour = '*'; this.dom_ = '*';
    this.month_ = '*'; this.dow_ = '*';
    return this;
  }

  /** Fire at minute 0 of every hour: `0 * * * *` */
  everyHour(): this {
    this.min = '0'; this.hour = '*'; this.dom_ = '*';
    this.month_ = '*'; this.dow_ = '*';
    return this;
  }

  /** Fire at midnight every day: `0 0 * * *` */
  daily(): this {
    this.min = '0'; this.hour = '0'; this.dom_ = '*';
    this.month_ = '*'; this.dow_ = '*';
    return this;
  }

  /** Fire at midnight on Sunday: `0 0 * * 0` */
  weekly(): this {
    this.daily();
    this.dow_ = '0';
    return this;
  }

  /** Fire at midnight on the 1st of each month: `0 0 1 * *` */
  monthly(): this {
    this.daily();
    this.dom_ = '1';
    return this;
  }

  /** Fire at midnight on Jan 1: `0 0 1 1 *` */
  yearly(): this {
    this.monthly();
    this.month_ = '1';
    return this;
  }

  /** Set hour and minute from a `"HH:MM"` string. */
  at(time: string): this {
    const colonIdx = time.indexOf(':');
    this.hour = String(parseInt(time.slice(0, colonIdx), 10));
    this.min  = String(parseInt(time.slice(colonIdx + 1), 10));
    return this;
  }

  /** Set seconds field (enables 6-field output). */
  atSecond(s: number): this {
    this._withSeconds = true;
    this.sec = String(s);
    return this;
  }

  atMinute(m: number): this { this.min  = String(m); return this; }
  atHour(h: number):   this { this.hour = String(h); return this; }

  /** Set day-of-month field (1-based). */
  onDays(...days: number[]): this {
    this.dom_ = days.join(',');
    return this;
  }

  /**
   * Set day-of-week field.  Accepts weekday names (`"mon"`, `"fri"`, …)
   * or numeric values (0 = Sun … 6 = Sat).
   */
  onWeekdays(...days: (string | number)[]): this {
    this.dow_ = days
      .map((d) =>
        typeof d === 'string'
          ? (DOW_NAMES_MAP[d.toLowerCase()] ?? String(d))
          : String(d),
      )
      .join(',');
    return this;
  }

  /**
   * Set month field.  Accepts month names (`"jan"`, `"dec"`, …)
   * or numeric values (1 = Jan … 12 = Dec).
   */
  onMonths(...months: (string | number)[]): this {
    this.month_ = months
      .map((m) =>
        typeof m === 'string'
          ? (MONTH_NAMES_MAP[m.toLowerCase()] ?? String(m))
          : String(m),
      )
      .join(',');
    return this;
  }

  /**
   * Set step expressions for one or more fields.
   * `everyN({ minute: 15 })` → `*\/15` in the minute field.
   */
  everyN(opts: {
    second?: number;
    minute?: number;
    hour?: number;
    dom?: number;
    month?: number;
  }): this {
    if (opts.second  !== undefined) { this._withSeconds = true; this.sec    = `*/${opts.second}`;  }
    if (opts.minute  !== undefined) { this.min    = `*/${opts.minute}`;  }
    if (opts.hour    !== undefined) { this.hour   = `*/${opts.hour}`;    }
    if (opts.dom     !== undefined) { this.dom_   = `*/${opts.dom}`;     }
    if (opts.month   !== undefined) { this.month_ = `*/${opts.month}`;   }
    return this;
  }

  /** Set an inclusive range on a single field. */
  between(opts: { field: BetweenField; from: number; to: number }): this {
    const range = `${opts.from}-${opts.to}`;
    switch (opts.field) {
      case 'second': this._withSeconds = true; this.sec    = range; break;
      case 'minute': this.min    = range; break;
      case 'hour':   this.hour   = range; break;
      case 'dom':    this.dom_   = range; break;
      case 'month':  this.month_ = range; break;
      case 'dow':    this.dow_   = range; break;
    }
    return this;
  }

  /**
   * Render the builder state as a cron expression string.
   * 5-field by default; 6-field when seconds have been configured.
   */
  toString(): string {
    if (this._withSeconds) {
      return `${this.sec} ${this.min} ${this.hour} ${this.dom_} ${this.month_} ${this.dow_}`;
    }
    return `${this.min} ${this.hour} ${this.dom_} ${this.month_} ${this.dow_}`;
  }
}

/** Create a new fluent CronBuilder. */
export function cron(): CronBuilder {
  return new CronBuilder();
}
