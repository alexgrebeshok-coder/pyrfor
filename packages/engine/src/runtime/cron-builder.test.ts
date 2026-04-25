// @vitest-environment node
/**
 * Tests for cron-builder.ts
 * Covers: fluent builder, parseCron (5-field, 6-field, aliases), matches,
 * nextRun, prevRun, L (last-day), d#n (nth-weekday), OR-semantics,
 * range/step/list combos, error handling, and impossible-spec null returns.
 *
 * Dates use local-time constructors (new Date(y, m, d, …)) so tests are
 * timezone-agnostic — the implementation schedules in local time throughout.
 */

import { describe, it, expect } from 'vitest';
import {
  cron,
  parseCron,
  matches,
  nextRun,
  prevRun,
  CronParseError,
  CronBuilder,
  type CronSpec,
} from './cron-builder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Local Date at minute resolution (seconds = 0). */
function d(
  year: number,
  month: number, // 1-based
  day: number,
  hour = 0,
  min  = 0,
  sec  = 0,
): Date {
  return new Date(year, month - 1, day, hour, min, sec);
}

/** Sorted array from a Set<number>. */
function sorted(s: Set<number>): number[] {
  return [...s].sort((a, b) => a - b);
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. FLUENT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('CronBuilder', () => {
  it('cron() returns a CronBuilder instance', () => {
    expect(cron()).toBeInstanceOf(CronBuilder);
  });

  it('everyMinute() → "* * * * *"', () => {
    expect(cron().everyMinute().toString()).toBe('* * * * *');
  });

  it('everyHour() → "0 * * * *"', () => {
    expect(cron().everyHour().toString()).toBe('0 * * * *');
  });

  it('daily() → "0 0 * * *"', () => {
    expect(cron().daily().toString()).toBe('0 0 * * *');
  });

  it('weekly() → "0 0 * * 0" (Sunday)', () => {
    expect(cron().weekly().toString()).toBe('0 0 * * 0');
  });

  it('monthly() → "0 0 1 * *"', () => {
    expect(cron().monthly().toString()).toBe('0 0 1 * *');
  });

  it('yearly() → "0 0 1 1 *"', () => {
    expect(cron().yearly().toString()).toBe('0 0 1 1 *');
  });

  it('daily().at("14:30") → "30 14 * * *"', () => {
    expect(cron().daily().at('14:30').toString()).toBe('30 14 * * *');
  });

  it('weekly().onWeekdays("mon") → "0 0 * * 1"', () => {
    expect(cron().weekly().onWeekdays('mon').toString()).toBe('0 0 * * 1');
  });

  it('onWeekdays("mon","wed","fri") sets dow to "1,3,5"', () => {
    expect(cron().onWeekdays('mon', 'wed', 'fri').toString()).toBe('* * * * 1,3,5');
  });

  it('onWeekdays with numeric values', () => {
    const expr = cron().onWeekdays(1, 3, 5).toString();
    const spec = parseCron(expr);
    expect(sorted(spec.dow)).toEqual([1, 3, 5]);
  });

  it('onDays(1, 15) sets dom field', () => {
    const expr = cron().onDays(1, 15).toString();
    const spec = parseCron(expr);
    expect(sorted(spec.dom)).toEqual([1, 15]);
  });

  it('onMonths("jan","jul") sets month field to "1,7"', () => {
    const expr = cron().onMonths('jan', 'jul').toString();
    const spec = parseCron(expr);
    expect(sorted(spec.months)).toEqual([1, 7]);
  });

  it('everyN({ minute: 15 }) → "*/15" in minute field', () => {
    expect(cron().everyN({ minute: 15 }).toString()).toBe('*/15 * * * *');
  });

  it('everyN({ hour: 2 }) → "*/2" in hour field', () => {
    expect(cron().everyN({ hour: 2 }).toString()).toBe('* */2 * * *');
  });

  it('atSecond(30) enables 6-field output', () => {
    const expr = cron().atSecond(30).toString();
    expect(expr.split(' ')).toHaveLength(6);
    expect(expr.startsWith('30 ')).toBe(true);
  });

  it('everyN({ second: 10 }) enables 6-field with */10 in second slot', () => {
    expect(cron().everyN({ second: 10 }).toString()).toBe('*/10 * * * * *');
  });

  it('between({ field: "hour", from: 9, to: 17 }) sets hour range', () => {
    const expr = cron().between({ field: 'hour', from: 9, to: 17 }).toString();
    const spec = parseCron(expr);
    expect(sorted(spec.hours)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('between({ field: "dow", from: 1, to: 5 }) → weekdays Mon-Fri', () => {
    const expr = cron().between({ field: 'dow', from: 1, to: 5 }).toString();
    const spec = parseCron(expr);
    expect(sorted(spec.dow)).toEqual([1, 2, 3, 4, 5]);
  });

  it('atMinute(30).atHour(9) sets minute and hour', () => {
    const spec = parseCron(cron().atMinute(30).atHour(9).toString());
    expect(sorted(spec.minutes)).toEqual([30]);
    expect(sorted(spec.hours)).toEqual([9]);
  });

  it('toString() produces parseable output for complex builder', () => {
    const expr = cron()
      .monthly()
      .at('08:00')
      .onMonths('jan', 'apr', 'jul', 'oct')
      .toString();
    const spec = parseCron(expr);
    expect(sorted(spec.minutes)).toEqual([0]);
    expect(sorted(spec.hours)).toEqual([8]);
    expect(sorted(spec.dom)).toEqual([1]);
    expect(sorted(spec.months)).toEqual([1, 4, 7, 10]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. parseCron — 5-field
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseCron (5-field)', () => {
  it('"*/5 * * * *" enumerates minutes [0,5,10,…,55]', () => {
    const spec = parseCron('*/5 * * * *');
    expect(sorted(spec.minutes)).toEqual(
      [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
    );
    expect(spec.hours.size).toBe(24);
  });

  it('"1-5 * * * *" → minutes {1,2,3,4,5}', () => {
    const spec = parseCron('1-5 * * * *');
    expect(sorted(spec.minutes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('"1,3,5 * * * *" → minutes {1,3,5}', () => {
    expect(sorted(parseCron('1,3,5 * * * *').minutes)).toEqual([1, 3, 5]);
  });

  it('"0-30/5 * * * *" → step over range gives {0,5,10,15,20,25,30}', () => {
    expect(sorted(parseCron('0-30/5 * * * *').minutes)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  it('originalDomStar and originalDowStar flags', () => {
    const spec = parseCron('0 0 1 * 0');
    expect(spec.originalDomStar).toBe(false);
    expect(spec.originalDowStar).toBe(false);

    const spec2 = parseCron('0 0 * * *');
    expect(spec2.originalDomStar).toBe(true);
    expect(spec2.originalDowStar).toBe(true);
  });

  it('month name aliases "jan-mar" expand to {1,2,3}', () => {
    const spec = parseCron('0 0 * jan-mar *');
    expect(sorted(spec.months)).toEqual([1, 2, 3]);
  });

  it('dow name aliases "mon,wed,fri" expand to {1,3,5}', () => {
    const spec = parseCron('0 0 * * mon,wed,fri');
    expect(sorted(spec.dow)).toEqual([1, 3, 5]);
  });

  it('"* * L * *" sets lastDom = true', () => {
    const spec = parseCron('* * L * *');
    expect(spec.lastDom).toBe(true);
    expect(spec.dom.size).toBe(0);
    expect(spec.originalDomStar).toBe(false);
  });

  it('"* * * * 2#3" sets nthWeekday = { dow:2, n:3 }', () => {
    const spec = parseCron('* * * * 2#3');
    expect(spec.nthWeekday).toEqual({ dow: 2, n: 3 });
    expect(spec.originalDowStar).toBe(false);
  });

  it('"* * * * tue#2" accepts day-name in #n syntax', () => {
    const spec = parseCron('* * * * tue#2');
    expect(spec.nthWeekday).toEqual({ dow: 2, n: 2 });
  });

  it('raw field is preserved', () => {
    expect(parseCron('0 0 * * *').raw).toBe('0 0 * * *');
  });

  it('withSeconds is false for 5-field parse', () => {
    expect(parseCron('0 0 * * *').withSeconds).toBe(false);
  });

  it('throws CronParseError for wrong field count', () => {
    expect(() => parseCron('0 0 * *')).toThrow(CronParseError);
    expect(() => parseCron('0 0 * * * *')).toThrow(CronParseError);
  });

  it('throws for minute value > 59', () => {
    expect(() => parseCron('60 * * * *')).toThrow(CronParseError);
  });

  it('throws for hour value > 23', () => {
    expect(() => parseCron('0 24 * * *')).toThrow(CronParseError);
  });

  it('throws for invalid range (lo > hi)', () => {
    expect(() => parseCron('5-1 * * * *')).toThrow(CronParseError);
  });

  it('throws for non-numeric value', () => {
    expect(() => parseCron('foo * * * *')).toThrow(CronParseError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. parseCron — aliases
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseCron (aliases)', () => {
  it('@hourly → minutes={0}, all hours', () => {
    const spec = parseCron('@hourly');
    expect(sorted(spec.minutes)).toEqual([0]);
    expect(spec.hours.size).toBe(24);
  });

  it('@daily → minutes={0}, hours={0}', () => {
    const spec = parseCron('@daily');
    expect(sorted(spec.minutes)).toEqual([0]);
    expect(sorted(spec.hours)).toEqual([0]);
    expect(spec.dom.size).toBe(31);
  });

  it('@weekly → dow contains only 0 (Sunday)', () => {
    const spec = parseCron('@weekly');
    expect(sorted(spec.dow)).toEqual([0]);
    expect(sorted(spec.hours)).toEqual([0]);
  });

  it('@monthly → dom={1}, all months', () => {
    const spec = parseCron('@monthly');
    expect(sorted(spec.dom)).toEqual([1]);
    expect(spec.months.size).toBe(12);
  });

  it('@yearly / @annually → dom={1}, months={1}', () => {
    const y = parseCron('@yearly');
    const a = parseCron('@annually');
    expect(sorted(y.dom)).toEqual([1]);
    expect(sorted(y.months)).toEqual([1]);
    expect(sorted(a.dom)).toEqual(sorted(y.dom));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. parseCron — 6-field (withSeconds)
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseCron (6-field)', () => {
  it('parses "30 */5 * * * *" — seconds={30}, minutes step', () => {
    const spec = parseCron('30 */5 * * * *', { withSeconds: true });
    expect(spec.withSeconds).toBe(true);
    expect(sorted(spec.seconds)).toEqual([30]);
    expect(sorted(spec.minutes)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it('parses "0 * * * * *" — fires every minute at second 0', () => {
    const spec = parseCron('0 * * * * *', { withSeconds: true });
    expect(sorted(spec.seconds)).toEqual([0]);
    expect(spec.minutes.size).toBe(60);
  });

  it('@hourly alias with withSeconds prepends second=0', () => {
    const spec = parseCron('@hourly', { withSeconds: true });
    expect(spec.withSeconds).toBe(true);
    expect(sorted(spec.seconds)).toEqual([0]);
    expect(sorted(spec.minutes)).toEqual([0]);
  });

  it('throws when 5-field expr is passed with withSeconds=true', () => {
    expect(() => parseCron('0 * * * *', { withSeconds: true })).toThrow(CronParseError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. matches()
// ═══════════════════════════════════════════════════════════════════════════════

describe('matches', () => {
  it('"0 0 * * *" matches local midnight', () => {
    const spec = parseCron('0 0 * * *');
    expect(matches(spec, d(2024, 1, 15, 0, 0, 0))).toBe(true);
  });

  it('"0 0 * * *" does NOT match 00:01', () => {
    const spec = parseCron('0 0 * * *');
    expect(matches(spec, d(2024, 1, 15, 0, 1, 0))).toBe(false);
  });

  it('"*/5 * * * *" matches at minute 0, 5, 55', () => {
    const spec = parseCron('*/5 * * * *');
    expect(matches(spec, d(2024, 1, 1, 12, 0))).toBe(true);
    expect(matches(spec, d(2024, 1, 1, 12, 5))).toBe(true);
    expect(matches(spec, d(2024, 1, 1, 12, 55))).toBe(true);
  });

  it('"*/5 * * * *" does NOT match at minute 1', () => {
    expect(matches(parseCron('*/5 * * * *'), d(2024, 1, 1, 12, 1))).toBe(false);
  });

  it('OR semantics: "0 0 1 * 1" matches the 1st of month', () => {
    // Feb 1 2024 is Thursday (not Monday) but dom=1 → OR → should match
    const spec = parseCron('0 0 1 * 1');
    expect(matches(spec, d(2024, 2, 1, 0, 0))).toBe(true);
  });

  it('OR semantics: "0 0 1 * 1" matches a Monday (not the 1st)', () => {
    // Jan 8 2024 is Monday, dom=8≠1 → OR: dowOk → should match
    const spec = parseCron('0 0 1 * 1');
    expect(matches(spec, d(2024, 1, 8, 0, 0))).toBe(true);
  });

  it('OR semantics: "0 0 1 * 1" does NOT match non-1st non-Monday', () => {
    // Jan 5 2024 is Friday (dow=5), dom=5≠1 → false
    const spec = parseCron('0 0 1 * 1');
    expect(matches(spec, d(2024, 1, 5, 0, 0))).toBe(false);
  });

  it('L: last day of January 2024 is 31', () => {
    const spec = parseCron('0 0 L * *');
    expect(matches(spec, d(2024, 1, 31, 0, 0))).toBe(true);
    expect(matches(spec, d(2024, 1, 30, 0, 0))).toBe(false);
  });

  it('L: last day of February 2024 is 29 (leap year)', () => {
    const spec = parseCron('0 0 L * *');
    expect(matches(spec, d(2024, 2, 29, 0, 0))).toBe(true);
    expect(matches(spec, d(2024, 2, 28, 0, 0))).toBe(false);
  });

  it('2#3: third Tuesday of Jan 2024 is the 16th', () => {
    // Tuesdays in Jan 2024: 2,9,16,23,30 → 3rd = 16
    const spec = parseCron('0 0 * * 2#3');
    expect(matches(spec, d(2024, 1, 16, 0, 0))).toBe(true);
    expect(matches(spec, d(2024, 1, 9,  0, 0))).toBe(false); // 2nd Tuesday
    expect(matches(spec, d(2024, 1, 23, 0, 0))).toBe(false); // 4th Tuesday
  });

  it('6-field: matches only when second is in set', () => {
    const spec = parseCron('30 0 * * * *', { withSeconds: true });
    expect(matches(spec, d(2024, 1, 1, 0, 0, 30))).toBe(true);
    expect(matches(spec, d(2024, 1, 1, 0, 0, 0))).toBe(false);
    expect(matches(spec, d(2024, 1, 1, 0, 0, 31))).toBe(false);
  });

  it('month boundary: "0 0 * 2 *" matches only in February', () => {
    const spec = parseCron('0 0 * 2 *');
    expect(matches(spec, d(2024, 2, 15, 0, 0))).toBe(true);
    expect(matches(spec, d(2024, 1, 15, 0, 0))).toBe(false);
    expect(matches(spec, d(2024, 3, 15, 0, 0))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. nextRun()
// ═══════════════════════════════════════════════════════════════════════════════

describe('nextRun', () => {
  it('"0 0 1 * *" from mid-January 2024 returns Feb 1 midnight', () => {
    const spec = parseCron('0 0 1 * *');
    const next = nextRun(spec, d(2024, 1, 15, 12, 0));
    expect(next).not.toBeNull();
    expect(next!.getFullYear()).toBe(2024);
    expect(next!.getMonth()).toBe(1);  // February (0-indexed)
    expect(next!.getDate()).toBe(1);
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(0);
  });

  it('"0 0 30 2 *" (Feb 30) → null — impossible date', () => {
    const spec = parseCron('0 0 30 2 *');
    expect(nextRun(spec, d(2024, 1, 1))).toBeNull();
  });

  it('"0 0 L * *" next L from Jan 15 → Jan 31', () => {
    const spec = parseCron('0 0 L * *');
    const next = nextRun(spec, d(2024, 1, 15, 0, 0));
    expect(next!.getDate()).toBe(31);
    expect(next!.getMonth()).toBe(0); // January
  });

  it('"0 0 * * 2#3" next 3rd Tuesday from Jan 1 2024 → Jan 16', () => {
    const spec = parseCron('0 0 * * 2#3');
    // Jan 1 2024 is Monday; from midnight on Jan 1 (excluded), next is Jan 16
    const next = nextRun(spec, d(2024, 1, 1, 0, 0));
    expect(next!.getDate()).toBe(16);
    expect(next!.getMonth()).toBe(0);
  });

  it('returns a date strictly after fromDate', () => {
    const spec = parseCron('0 * * * *'); // every hour
    const from = d(2024, 1, 1, 14, 0, 0);
    const next = nextRun(spec, from);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it('6-field nextRun finds next second-0 minute', () => {
    const spec = parseCron('0 * * * * *', { withSeconds: true });
    const from = d(2024, 1, 1, 0, 0, 15);  // 00:00:15
    const next = nextRun(spec, from);
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(1);  // next minute
    expect(next!.getSeconds()).toBe(0);
  });

  it('6-field: impossible spec returns null', () => {
    // "0 0 30 2 * *" — Feb 30, 00:00:00
    const spec = parseCron('0 0 0 30 2 *', { withSeconds: true });
    expect(nextRun(spec, d(2024, 1, 1))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G. prevRun()
// ═══════════════════════════════════════════════════════════════════════════════

describe('prevRun', () => {
  it('"0 0 * * *" prev from Jan 15 noon → Jan 15 midnight', () => {
    const spec = parseCron('0 0 * * *');
    const prev = prevRun(spec, d(2024, 1, 15, 12, 0));
    expect(prev!.getDate()).toBe(15);
    expect(prev!.getHours()).toBe(0);
    expect(prev!.getMinutes()).toBe(0);
  });

  it('"0 0 * * *" prev from exactly midnight → previous midnight', () => {
    const spec = parseCron('0 0 * * *');
    const from = d(2024, 1, 15, 0, 0, 0);
    const prev = prevRun(spec, from);
    expect(prev!.getTime()).toBeLessThan(from.getTime());
    expect(prev!.getDate()).toBe(14); // Jan 14
  });

  it('prevRun + nextRun symmetry: nextRun of T is recovered via prevRun(T + 1 min)', () => {
    const spec = parseCron('*/15 * * * *');
    const next = nextRun(spec, d(2024, 1, 1, 14, 0));
    expect(next).not.toBeNull();
    // prevRun from 1 minute after next should return next
    const prev = prevRun(spec, new Date(next!.getTime() + 60_000));
    expect(prev!.getTime()).toBe(next!.getTime());
  });

  it('"0 0 30 2 *" impossible spec → null', () => {
    expect(prevRun(parseCron('0 0 30 2 *'), d(2024, 6, 1))).toBeNull();
  });

  it('6-field prevRun finds previous second', () => {
    const spec = parseCron('30 * * * * *', { withSeconds: true });
    const from = d(2024, 1, 1, 14, 5, 45); // 14:05:45
    const prev = prevRun(spec, from);
    expect(prev!.getMinutes()).toBe(5);
    expect(prev!.getSeconds()).toBe(30);
  });

  it('returns a date strictly before fromDate', () => {
    const spec = parseCron('0 * * * *');
    const from = d(2024, 1, 1, 10, 0, 0);
    const prev = prevRun(spec, from);
    expect(prev!.getTime()).toBeLessThan(from.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// H. Edge-cases & combinations
// ═══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('list + range combination "1,3,5-8 * * * *"', () => {
    const spec = parseCron('1,3,5-8 * * * *');
    expect(sorted(spec.minutes)).toEqual([1, 3, 5, 6, 7, 8]);
  });

  it('step "1-10/3 * * * *" → {1,4,7,10}', () => {
    expect(sorted(parseCron('1-10/3 * * * *').minutes)).toEqual([1, 4, 7, 10]);
  });

  it('nextRun "*/5 * * * *" from 14:03 → 14:05', () => {
    const spec = parseCron('*/5 * * * *');
    const next = nextRun(spec, d(2024, 1, 1, 14, 3));
    expect(next!.getHours()).toBe(14);
    expect(next!.getMinutes()).toBe(5);
  });

  it('nextRun "*/5 * * * *" from exactly 14:05 → 14:10 (strict)', () => {
    const spec = parseCron('*/5 * * * *');
    const next = nextRun(spec, d(2024, 1, 1, 14, 5, 0));
    expect(next!.getMinutes()).toBe(10);
  });

  it('parseCron preserves raw expression including alias', () => {
    expect(parseCron('@daily').raw).toBe('@daily');
  });

  it('dow "7" is rejected (out of range 0-6)', () => {
    expect(() => parseCron('0 0 * * 7')).toThrow(CronParseError);
  });

  it('month "13" is rejected', () => {
    expect(() => parseCron('0 0 * 13 *')).toThrow(CronParseError);
  });

  it('step of 0 is rejected', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(CronParseError);
  });

  it('CronParseError has correct name', () => {
    try {
      parseCron('invalid');
    } catch (e) {
      expect(e).toBeInstanceOf(CronParseError);
      expect((e as CronParseError).name).toBe('CronParseError');
    }
  });
});
