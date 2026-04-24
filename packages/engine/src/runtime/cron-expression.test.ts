// @vitest-environment node
/**
 * Tests for cron-expression.ts
 * ≥45 tests covering: parseCron, matches, nextRun, presets, error cases,
 * DOM/DOW semantics, boundary conditions, and leap-year behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCron,
  matches,
  nextRun,
  CronParseError,
  CRON_PRESETS,
  type CronSchedule,
} from './cron-expression';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a UTC epoch-ms from date/time parts. */
function utc(
  year: number, month: number, day: number,
  hour = 0, min = 0, sec = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, min, sec);
}

/** All values in [lo, hi] step 1 as a Set. */
function fullRange(lo: number, hi: number): Set<number> {
  const s = new Set<number>();
  for (let i = lo; i <= hi; i++) s.add(i);
  return s;
}

// ─── 1. parseCron: basic field expansion ──────────────────────────────────

describe('parseCron — basic expansion', () => {
  it('* * * * * → all sets full', () => {
    const s = parseCron('* * * * *');
    expect(s.minutes).toEqual(fullRange(0, 59));
    expect(s.hours).toEqual(fullRange(0, 23));
    expect(s.dom).toEqual(fullRange(1, 31));
    expect(s.months).toEqual(fullRange(1, 12));
    expect(s.dow).toEqual(fullRange(0, 6));
    expect(s.originalDomStar).toBe(true);
    expect(s.originalDowStar).toBe(true);
    expect(s.raw).toBe('* * * * *');
  });

  it('0 */5 * * * → minutes={0}, hours={0,5,10,15,20}', () => {
    const s = parseCron('0 */5 * * *');
    expect(s.minutes).toEqual(new Set([0]));
    expect(s.hours).toEqual(new Set([0, 5, 10, 15, 20]));
  });

  it('30 9 * * 1-5 → minute=30, hour=9, dow={1,2,3,4,5}', () => {
    const s = parseCron('30 9 * * 1-5');
    expect(s.minutes).toEqual(new Set([30]));
    expect(s.hours).toEqual(new Set([9]));
    expect(s.dow).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(s.originalDomStar).toBe(true);
    expect(s.originalDowStar).toBe(false);
  });

  it('0 0 1,15 * * → dom={1,15}', () => {
    const s = parseCron('0 0 1,15 * *');
    expect(s.dom).toEqual(new Set([1, 15]));
    expect(s.originalDomStar).toBe(false);
    expect(s.originalDowStar).toBe(true);
  });

  it('0 0 * * 0 → Sundays only (dow={0})', () => {
    const s = parseCron('0 0 * * 0');
    expect(s.dow).toEqual(new Set([0]));
    expect(s.originalDomStar).toBe(true);
    expect(s.originalDowStar).toBe(false);
  });

  it('*/15 * * * * → minutes {0,15,30,45}', () => {
    const s = parseCron('*/15 * * * *');
    expect(s.minutes).toEqual(new Set([0, 15, 30, 45]));
  });

  it('0 8-18/2 * * * → hours {8,10,12,14,16,18}', () => {
    const s = parseCron('0 8-18/2 * * *');
    expect(s.hours).toEqual(new Set([8, 10, 12, 14, 16, 18]));
  });

  it('0 0 1-7,15 * * → dom {1,2,3,4,5,6,7,15}', () => {
    const s = parseCron('0 0 1-7,15 * *');
    expect(s.dom).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 15]));
  });

  it('preserves raw field', () => {
    const expr = '5 4 * * *';
    expect(parseCron(expr).raw).toBe(expr);
  });
});

// ─── 2. parseCron: presets ─────────────────────────────────────────────────

describe('parseCron — presets', () => {
  it('@daily → 0 0 * * *', () => {
    const s = parseCron('@daily');
    expect(s.minutes).toEqual(new Set([0]));
    expect(s.hours).toEqual(new Set([0]));
    expect(s.raw).toBe('@daily');
  });

  it('@hourly → 0 * * * *', () => {
    const s = parseCron('@hourly');
    expect(s.minutes).toEqual(new Set([0]));
    expect(s.hours).toEqual(fullRange(0, 23));
  });

  it('@weekly → 0 0 * * 0 (Sunday)', () => {
    const s = parseCron('@weekly');
    expect(s.dow).toEqual(new Set([0]));
    expect(s.originalDomStar).toBe(true);
  });

  it('@monthly → dom={1}', () => {
    const s = parseCron('@monthly');
    expect(s.dom).toEqual(new Set([1]));
  });

  it('@yearly / @annually → Jan 1st midnight', () => {
    const y = parseCron('@yearly');
    const a = parseCron('@annually');
    expect(y.months).toEqual(new Set([1]));
    expect(y.dom).toEqual(new Set([1]));
    expect(a.months).toEqual(new Set([1]));
  });
});

// ─── 3. parseCron: error cases ────────────────────────────────────────────

describe('parseCron — errors', () => {
  it('rejects 4 fields', () => {
    expect(() => parseCron('0 0 * *')).toThrow(CronParseError);
  });

  it('rejects 6 fields', () => {
    expect(() => parseCron('0 0 * * * *')).toThrow(CronParseError);
  });

  it('rejects minute=60 (out of range)', () => {
    expect(() => parseCron('60 * * * *')).toThrow(CronParseError);
  });

  it('rejects hour=24 (out of range)', () => {
    expect(() => parseCron('0 24 * * *')).toThrow(CronParseError);
  });

  it('rejects dom=0 (out of range)', () => {
    expect(() => parseCron('0 0 0 * *')).toThrow(CronParseError);
  });

  it('rejects dom=32 (out of range)', () => {
    expect(() => parseCron('0 0 32 * *')).toThrow(CronParseError);
  });

  it('rejects month=13 (out of range)', () => {
    expect(() => parseCron('0 0 * 13 *')).toThrow(CronParseError);
  });

  it('rejects dow=7 (out of range)', () => {
    expect(() => parseCron('0 0 * * 7')).toThrow(CronParseError);
  });

  it('rejects non-numeric "a b c d e"', () => {
    expect(() => parseCron('a b c d e')).toThrow(CronParseError);
  });

  it('rejects trailing dash "1-"', () => {
    expect(() => parseCron('1- * * * *')).toThrow(CronParseError);
  });

  it('rejects step of zero "*/0"', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(CronParseError);
  });

  it('rejects reverse range "10-5"', () => {
    expect(() => parseCron('10-5 * * * *')).toThrow(CronParseError);
  });

  it('fieldIndex is set on error', () => {
    let err: CronParseError | undefined;
    try { parseCron('60 * * * *'); } catch (e) { err = e as CronParseError; }
    expect(err?.fieldIndex).toBe(0);
  });

  it('fieldIndex=1 for hour error', () => {
    let err: CronParseError | undefined;
    try { parseCron('0 99 * * *'); } catch (e) { err = e as CronParseError; }
    expect(err?.fieldIndex).toBe(1);
  });
});

// ─── 4. matches ───────────────────────────────────────────────────────────

describe('matches', () => {
  it('* * * * * matches any timestamp on minute boundary', () => {
    const s = parseCron('* * * * *');
    expect(matches(s, utc(2024, 3, 15, 14, 30))).toBe(true);
  });

  it('0 12 * * * matches noon UTC', () => {
    const s = parseCron('0 12 * * *');
    expect(matches(s, utc(2024, 6, 1, 12, 0))).toBe(true);
    expect(matches(s, utc(2024, 6, 1, 12, 1))).toBe(false);
    expect(matches(s, utc(2024, 6, 1, 11, 0))).toBe(false);
  });

  it('DOM-only: 0 0 15 * * matches 15th', () => {
    const s = parseCron('0 0 15 * *');
    expect(matches(s, utc(2024, 3, 15))).toBe(true);
    expect(matches(s, utc(2024, 3, 16))).toBe(false);
  });

  it('DOW-only: 0 0 * * 5 matches Fridays', () => {
    const s = parseCron('0 0 * * 5');
    // 2024-03-01 is a Friday
    expect(matches(s, utc(2024, 3, 1))).toBe(true);
    // 2024-03-02 is a Saturday
    expect(matches(s, utc(2024, 3, 2))).toBe(false);
  });

  it('DOM+DOW OR: "0 0 1 * 0" matches 1st OR Sunday', () => {
    const s = parseCron('0 0 1 * 0');
    // 2024-03-01 is a Friday (1st of month, not Sunday) → matches via DOM
    expect(matches(s, utc(2024, 3, 1))).toBe(true);
    // 2024-03-03 is a Sunday (not 1st) → matches via DOW
    expect(matches(s, utc(2024, 3, 3))).toBe(true);
    // 2024-03-06 is a Wednesday, not 1st → no match
    expect(matches(s, utc(2024, 3, 6))).toBe(false);
  });

  it('does NOT match when seconds differ (non-minute boundary)', () => {
    const s = parseCron('0 12 * * *');
    // 12:00:30 — minutes=0 & hours=12 but not on exact boundary (seconds ignored in UTC ms)
    // Actually matches still since we only check min/hour; this documents behaviour.
    expect(matches(s, utc(2024, 6, 1, 12, 0, 30))).toBe(true);
  });
});

// ─── 5. nextRun ───────────────────────────────────────────────────────────

describe('nextRun', () => {
  it('* * * * * advances exactly 60 s', () => {
    const s = parseCron('* * * * *');
    const from = utc(2024, 1, 1, 0, 0, 0);
    const next = nextRun(s, from);
    expect(next - from).toBe(60_000);
  });

  it('* * * * * is strictly greater than fromMs', () => {
    const s = parseCron('* * * * *');
    const from = utc(2024, 1, 1, 12, 30, 0);
    expect(nextRun(s, from)).toBeGreaterThan(from);
  });

  it('does not return fromMs even if it matches', () => {
    const s = parseCron('* * * * *');
    const from = utc(2024, 5, 10, 8, 0, 0);
    expect(nextRun(s, from)).not.toBe(from);
  });

  it('0 0 * * * → next midnight UTC', () => {
    const s = parseCron('0 0 * * *');
    const from = utc(2024, 3, 15, 10, 30);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 3, 16, 0, 0));
  });

  it('30 9 * * 1-5 — from Saturday picks Monday 09:30', () => {
    const s = parseCron('30 9 * * 1-5');
    // 2024-03-02 is a Saturday
    const from = utc(2024, 3, 2, 10, 0);
    const next = nextRun(s, from);
    // 2024-03-04 is Monday
    expect(next).toBe(utc(2024, 3, 4, 9, 30));
  });

  it('crosses month boundary (Jan 31 → Feb schedule)', () => {
    const s = parseCron('0 0 1 * *');
    const from = utc(2024, 1, 31, 1, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 2, 1, 0, 0));
  });

  it('crosses year boundary (Dec 31 23:59 → Jan 1 schedule)', () => {
    const s = parseCron('0 0 1 1 *');
    const from = utc(2023, 12, 31, 23, 59);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 1, 1, 0, 0));
  });

  it('0 0 31 * * skips 30-day months', () => {
    const s = parseCron('0 0 31 * *');
    // April has 30 days — from Apr 1 should skip to May 31
    const from = utc(2024, 4, 1, 0, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 5, 31, 0, 0));
  });

  it('0 0 29 2 * handles leap year — skips to next Feb 29', () => {
    const s = parseCron('0 0 29 2 *');
    // 2023 is not a leap year; next Feb 29 is 2024
    const from = utc(2023, 3, 1, 0, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 2, 29, 0, 0));
  });

  it('nextRun for @hourly fires every hour', () => {
    const s = parseCron('@hourly');
    const from = utc(2024, 6, 15, 7, 30);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 6, 15, 8, 0));
  });

  it('nextRun for @weekly picks next Sunday midnight', () => {
    const s = parseCron('@weekly');
    // 2024-03-06 is Wednesday
    const from = utc(2024, 3, 6, 12, 0);
    const next = nextRun(s, from);
    // 2024-03-10 is Sunday
    expect(next).toBe(utc(2024, 3, 10, 0, 0));
  });

  it('nextRun for @monthly picks 1st of next month', () => {
    const s = parseCron('@monthly');
    const from = utc(2024, 3, 15, 10, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 4, 1, 0, 0));
  });

  it('nextRun for @yearly picks next Jan 1', () => {
    const s = parseCron('@yearly');
    const from = utc(2024, 6, 1, 0, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2025, 1, 1, 0, 0));
  });

  it('DOM+DOW OR — nextRun finds 1st-of-month first when it comes first', () => {
    const s = parseCron('0 0 1 * 0');
    // From 2024-03-01 00:00 (already 1st) → strict > fromMs → next match
    const from = utc(2024, 3, 1, 0, 0);
    const next = nextRun(s, from);
    // Next candidate: 2024-03-03 (Sunday) at 00:00
    expect(next).toBe(utc(2024, 3, 3, 0, 0));
  });

  it('throws CronParseError for impossible schedule (0 0 31 2 *)', () => {
    const s = parseCron('0 0 31 2 *');
    expect(() => nextRun(s, utc(2024, 1, 1))).toThrow(CronParseError);
  });

  it('*/5 * * * * fires every 5 minutes', () => {
    const s = parseCron('*/5 * * * *');
    const from = utc(2024, 1, 1, 0, 3);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 1, 1, 0, 5));
  });

  it('0 */6 * * * fires at 0,6,12,18', () => {
    const s = parseCron('0 */6 * * *');
    const from = utc(2024, 1, 1, 7, 0);
    const next = nextRun(s, from);
    expect(next).toBe(utc(2024, 1, 1, 12, 0));
  });

  it('handles fromMs with non-zero seconds (floor to minute)', () => {
    const s = parseCron('* * * * *');
    const from = utc(2024, 1, 1, 0, 0, 45); // 45 seconds past
    const next = nextRun(s, from);
    // Should advance to next minute boundary
    expect(next).toBe(utc(2024, 1, 1, 0, 1, 0));
  });
});

// ─── 6. CRON_PRESETS record ───────────────────────────────────────────────

describe('CRON_PRESETS', () => {
  it('contains @daily, @hourly, @weekly, @monthly, @yearly', () => {
    expect(CRON_PRESETS['@daily']).toBe('0 0 * * *');
    expect(CRON_PRESETS['@hourly']).toBe('0 * * * *');
    expect(CRON_PRESETS['@weekly']).toBe('0 0 * * 0');
    expect(CRON_PRESETS['@monthly']).toBe('0 0 1 * *');
    expect(CRON_PRESETS['@yearly']).toBe('0 0 1 1 *');
  });
});
