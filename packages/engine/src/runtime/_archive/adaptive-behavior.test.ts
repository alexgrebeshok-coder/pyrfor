// @vitest-environment node
/**
 * adaptive-behavior.test.ts — tests for createAdaptiveBehavior, inferWakeSleep,
 * and classifyEnergy.
 *
 * Uses a local __adaptive_behavior_test_tmp__ directory (relative to this file)
 * instead of /tmp so temporary files stay inside the project tree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  createAdaptiveBehavior,
  inferWakeSleep,
  classifyEnergy,
  type ActivityEvent,
  type EnergyEstimate,
} from './adaptive-behavior.js';

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_BASE = path.join(__dirname, '__adaptive_behavior_test_tmp__');
const _tmpFiles: string[] = [];

async function tmpFile(name = 'store.json'): Promise<string> {
  await fsp.mkdir(TMP_BASE, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const p = path.join(TMP_BASE, `${unique}-${name}`);
  _tmpFiles.push(p);
  return p;
}

afterEach(async () => {
  _tmpFiles.splice(0);
  await fsp.rm(TMP_BASE, { recursive: true, force: true }).catch(() => undefined);
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Clock fixed at a given UTC hour on 2024-01-15. */
function clockAt(utcHour: number): () => number {
  const d = new Date('2024-01-15T00:00:00Z');
  d.setUTCHours(utcHour, 0, 0, 0);
  return () => d.getTime();
}

function makeEvent(
  userId: string,
  ts: number,
  kind: ActivityEvent['kind'] = 'message',
  meta?: ActivityEvent['meta'],
): ActivityEvent {
  return { ts, userId, kind, meta };
}

/** Build N events at a specific UTC hour on successive days starting 2024-01-01. */
function eventsAtHour(userId: string, hour: number, count: number): ActivityEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`2024-01-${String(i % 28 + 1).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`);
    return makeEvent(userId, d.getTime());
  });
}

/** UTC timestamp for specific date + hour. */
function ts(dateStr: string, utcHour: number): number {
  const d = new Date(`${dateStr}T${String(utcHour).padStart(2, '0')}:00:00Z`);
  return d.getTime();
}

// ── enabled / disable ─────────────────────────────────────────────────────────

describe('enabled flag', () => {
  it('defaults to false', () => {
    const ab = createAdaptiveBehavior();
    expect(ab.isEnabled()).toBe(false);
  });

  it('enabled: true in options starts enabled', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    expect(ab.isEnabled()).toBe(true);
  });

  it('enable() transitions disabled → enabled', () => {
    const ab = createAdaptiveBehavior();
    ab.enable();
    expect(ab.isEnabled()).toBe(true);
  });

  it('disable() transitions enabled → disabled', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.disable();
    expect(ab.isEnabled()).toBe(false);
  });
});

// ── recordEvent ───────────────────────────────────────────────────────────────

describe('recordEvent', () => {
  it('is a no-op when disabled', () => {
    const ab = createAdaptiveBehavior(); // disabled
    ab.recordEvent(makeEvent('u1', Date.now()));
    // enabling afterwards should reveal empty store
    ab.enable();
    expect(ab.events('u1')).toHaveLength(0);
  });

  it('appends events when enabled', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('u1', 1000));
    ab.recordEvent(makeEvent('u1', 2000));
    expect(ab.events('u1')).toHaveLength(2);
  });

  it('caps at 5000 per user, dropping oldest', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    const N = 5005;
    for (let i = 0; i < N; i++) {
      ab.recordEvent(makeEvent('u1', i));
    }
    const stored = ab.events('u1');
    expect(stored).toHaveLength(5000);
    // oldest N-5000 = 5 events dropped; first stored ts should be 5
    expect(stored[0].ts).toBe(5);
  });

  it('keeps events per-user isolated', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('alice', 100));
    ab.recordEvent(makeEvent('bob', 200));
    expect(ab.events('alice')).toHaveLength(1);
    expect(ab.events('bob')).toHaveLength(1);
  });
});

// ── schedule ──────────────────────────────────────────────────────────────────

describe('schedule', () => {
  it('returns defaults when below minEventsForSchedule', () => {
    const ab = createAdaptiveBehavior({ enabled: true, minEventsForSchedule: 50 });
    for (let i = 0; i < 10; i++) ab.recordEvent(makeEvent('u1', i));
    const s = ab.schedule('u1');
    expect(s.wakeHour).toBe(8);
    expect(s.sleepHour).toBe(23);
    expect(s.hourly).toHaveLength(24);
    expect(s.hourly.every(v => v === 0)).toBe(true);
    expect(s.totalEvents).toBe(10);
  });

  it('returns defaults schedule when disabled', () => {
    const ab = createAdaptiveBehavior(); // disabled
    const s = ab.schedule('u1');
    expect(s.totalEvents).toBe(0);
    expect(s.hourly.every(v => v === 0)).toBe(true);
  });

  it('computes hourly distribution normalised to 1.0 at peak hour', () => {
    const ab = createAdaptiveBehavior({ enabled: true, minEventsForSchedule: 10 });
    // 20 events at hour 10, 10 events at hour 14
    eventsAtHour('u1', 10, 20).forEach(e => ab.recordEvent(e));
    eventsAtHour('u1', 14, 10).forEach(e => ab.recordEvent(e));
    const s = ab.schedule('u1');
    expect(s.hourly[10]).toBeCloseTo(1.0);
    expect(s.hourly[14]).toBeCloseTo(0.5);
    expect(s.hourly[0]).toBe(0);
  });

  it('computes weekly distribution', () => {
    const ab = createAdaptiveBehavior({ enabled: true, minEventsForSchedule: 10 });
    // Jan 2024: Mon=1, Wed=3.  Known Monday dates: 1, 8, 15, 22, 29.  Wed: 3, 10, 17, 24, 31.
    const monDates = ['2024-01-01', '2024-01-08', '2024-01-15', '2024-01-22', '2024-01-29'];
    const wedDates = ['2024-01-03', '2024-01-10'];
    const monEvts = monDates.flatMap(d =>
      // 2 events per Monday = 10 Monday events total
      [makeEvent('u1', ts(d, 9)), makeEvent('u1', ts(d, 11))],
    );
    const wedEvts = wedDates.map(d => makeEvent('u1', ts(d, 10)));
    [...monEvts, ...wedEvts].forEach(e => ab.recordEvent(e));
    const s = ab.schedule('u1');
    // Mon(1) has 10 events; Wed(3) has 2 events → normalised Mon > Wed
    expect(s.weekly[1]).toBeGreaterThan(s.weekly[3]);
    expect(s.weekly[0]).toBe(0); // no Sunday events
  });

  it('wakeHour and sleepHour reflect active hours', () => {
    const ab = createAdaptiveBehavior({ enabled: true, minEventsForSchedule: 10 });
    // 30 events at hour 9, 30 events at hour 17
    eventsAtHour('u1', 9, 30).forEach(e => ab.recordEvent(e));
    eventsAtHour('u1', 17, 30).forEach(e => ab.recordEvent(e));
    const s = ab.schedule('u1');
    expect(s.wakeHour).toBe(9);
    expect(s.sleepHour).toBe(17);
  });
});

// ── inferWakeSleep ────────────────────────────────────────────────────────────

describe('inferWakeSleep', () => {
  it('identifies wake and sleep hours from a morning-active distribution', () => {
    // Active 8am–17pm at high probability, rest near zero
    const hourly = Array<number>(24).fill(0);
    for (let h = 8; h <= 17; h++) hourly[h] = 0.8;
    const { wakeHour, sleepHour } = inferWakeSleep(hourly);
    expect(wakeHour).toBe(8);
    expect(sleepHour).toBe(17);
  });

  it('falls back to defaults on all-zero array', () => {
    const { wakeHour, sleepHour } = inferWakeSleep(Array<number>(24).fill(0));
    expect(wakeHour).toBe(8);
    expect(sleepHour).toBe(23);
  });

  it('does not throw on degenerate inputs', () => {
    expect(() => inferWakeSleep([])).not.toThrow();
    expect(() => inferWakeSleep(null as unknown as number[])).not.toThrow();
    expect(() => inferWakeSleep([0.9])).not.toThrow();
  });

  it('skips pre-4am hours when searching for wakeHour', () => {
    // Active only at hour 2 (night owl scenario - below 4am search start)
    const hourly = Array<number>(24).fill(0);
    hourly[2] = 0.9;
    hourly[14] = 0.9; // also active at 2pm
    const { wakeHour } = inferWakeSleep(hourly);
    // Search starts at 4, wraps around; 2pm (14) should be found
    expect(wakeHour).toBe(14);
  });
});

// ── classifyEnergy ────────────────────────────────────────────────────────────

describe('classifyEnergy', () => {
  it('score 0.0 → low', () => expect(classifyEnergy(0.0)).toBe('low'));
  it('score 0.33 → low', () => expect(classifyEnergy(0.33)).toBe('low'));
  it('score 0.34 → medium', () => expect(classifyEnergy(0.34)).toBe('medium'));
  it('score 0.5 → medium', () => expect(classifyEnergy(0.5)).toBe('medium'));
  it('score 0.66 → medium', () => expect(classifyEnergy(0.66)).toBe('medium'));
  it('score 0.67 → high', () => expect(classifyEnergy(0.67)).toBe('high'));
  it('score 1.0 → high', () => expect(classifyEnergy(1.0)).toBe('high'));
});

// ── energy ────────────────────────────────────────────────────────────────────

describe('energy', () => {
  it('returns default estimate when disabled', () => {
    const ab = createAdaptiveBehavior();
    const e = ab.energy('u1');
    expect(e.level).toBe('medium');
    expect(e.reasons).toContain('module disabled');
  });

  it('time-of-day fatigue at 3am → low energy (no other signals)', () => {
    // At 3am the TOD factor is 0.0 → score = 0.0 → 'low'
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(3) });
    const e = ab.energy('u1');
    expect(e.level).toBe('low');
    expect(e.score).toBeCloseTo(0, 5);
    expect(e.reasons).toContain('early-morning fatigue');
  });

  it('peak-day hours at 10am → high energy (no other signals)', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const e = ab.energy('u1');
    expect(e.level).toBe('high');
    expect(e.score).toBeCloseTo(1.0, 5);
  });

  it('voice rate above baseline boosts energy score', () => {
    // At 3am (tod=0), high wpm should lift score above 0
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(3) });
    const recentEvents: ActivityEvent[] = [
      makeEvent('u1', clockAt(3)(), 'voice', { voiceRateWpm: 200 }),
    ];
    const e = ab.energy('u1', { recentEvents });
    // voiceScore = 200/140 ≈ 1.0; score = 0*0.5 + 1.0*0.5 = 0.5 → medium
    expect(e.score).toBeGreaterThan(0);
    expect(e.reasons).toContain('fast voice rate');
  });

  it('low task density at evening hour → low energy', () => {
    // 10pm: tod ≈ 0.29; density=0; score ≈ 0.15 → low
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(22) });
    const e = ab.energy('u1', { currentTaskDensity: 0 });
    expect(e.level).toBe('low');
    expect(e.reasons).toContain('low task density');
  });

  it('high task density at noon boosts energy', () => {
    // noon: tod ≈ 0.86; density=10 → densityScore=1.0
    // score = 0.86*0.4 + 0.5*0.3 + 1.0*0.3 = 0.344 + 0.15 + 0.3 ≈ 0.79 → high
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(12) });
    const e = ab.energy('u1', { currentTaskDensity: 10 });
    expect(e.level).toBe('high');
    expect(e.reasons).toContain('high task density');
  });

  it('includes reasons array', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const e = ab.energy('u1');
    expect(Array.isArray(e.reasons)).toBe(true);
    expect(e.reasons.length).toBeGreaterThan(0);
  });
});

// ── tone ──────────────────────────────────────────────────────────────────────

describe('tone', () => {
  it('returns neutral default when disabled', () => {
    const ab = createAdaptiveBehavior();
    expect(ab.tone('u1').preset).toBe('neutral');
  });

  it('low energy → caring', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(14) });
    const lowEnergy: EnergyEstimate = { level: 'low', score: 0.1, reasons: [] };
    expect(ab.tone('u1', { energy: lowEnergy }).preset).toBe('caring');
  });

  it('negative sentiment → caring', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(14) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    expect(ab.tone('u1', { sentiment: 'neg', energy: medEnergy }).preset).toBe('caring');
  });

  it('morning hour → terse', () => {
    // h=9 ≤ morningEndHour(11), medium energy, no neg sentiment
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(9) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const t = ab.tone('u1', { energy: medEnergy });
    expect(t.preset).toBe('terse');
    expect(t.reason).toBe('morning hours');
  });

  it('deadline near (≤15 min) → terse', () => {
    // afternoon hour, medium energy, short deadline
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(14) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const t = ab.tone('u1', { energy: medEnergy, deadlineNearMin: 10 });
    expect(t.preset).toBe('terse');
    expect(t.reason).toBe('deadline imminent');
  });

  it('evening hour → detailed', () => {
    // h=20 ≥ eveningStartHour(19), medium energy
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(20) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const t = ab.tone('u1', { energy: medEnergy });
    expect(t.preset).toBe('detailed');
    expect(t.reason).toBe('evening hours');
  });

  it('neutral during normal working hours', () => {
    // h=14, medium energy, no neg sentiment, no deadline
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(14) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const t = ab.tone('u1', { energy: medEnergy });
    expect(t.preset).toBe('neutral');
  });

  it('low energy takes priority over morning terse', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(8) });
    const lowEnergy: EnergyEstimate = { level: 'low', score: 0.1, reasons: [] };
    expect(ab.tone('u1', { energy: lowEnergy }).preset).toBe('caring');
  });

  it('deadline > 15 min does not force terse', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(14) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const t = ab.tone('u1', { energy: medEnergy, deadlineNearMin: 30 });
    expect(t.preset).toBe('neutral');
  });
});

// ── proactivity ───────────────────────────────────────────────────────────────

describe('proactivity', () => {
  it('returns no-nudge when disabled', () => {
    const ab = createAdaptiveBehavior();
    expect(ab.proactivity('u1').shouldNudge).toBe(false);
  });

  it('nudges when deadline ≤60 min and energy is medium', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    const p = ab.proactivity('u1', { deadlineNearMin: 45, energy: medEnergy });
    expect(p.shouldNudge).toBe(true);
  });

  it('no nudge when energy is low', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const lowEnergy: EnergyEstimate = { level: 'low', score: 0.1, reasons: [] };
    const p = ab.proactivity('u1', { deadlineNearMin: 30, energy: lowEnergy });
    expect(p.shouldNudge).toBe(false);
    expect(p.reason).toContain('low energy');
  });

  it('no nudge when no imminent deadline', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    expect(ab.proactivity('u1', { energy: medEnergy }).shouldNudge).toBe(false);
  });

  it('no nudge when deadline > 60 min', () => {
    const ab = createAdaptiveBehavior({ enabled: true, clock: clockAt(10) });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    expect(ab.proactivity('u1', { deadlineNearMin: 90, energy: medEnergy }).shouldNudge).toBe(
      false,
    );
  });

  it('cooldown blocks repeat nudge', () => {
    const nowMs = clockAt(10)();
    const ab = createAdaptiveBehavior({
      enabled: true,
      clock: () => nowMs,
      nudgeCooldownMinutes: 30,
    });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    // lastNudgeTs 5 minutes ago → still within 30-min cooldown
    const p = ab.proactivity('u1', {
      deadlineNearMin: 30,
      energy: medEnergy,
      lastNudgeTs: nowMs - 5 * 60_000,
    });
    expect(p.shouldNudge).toBe(false);
    expect(p.reason).toContain('cooldown');
  });

  it('nudges after cooldown has expired', () => {
    const nowMs = clockAt(10)();
    const ab = createAdaptiveBehavior({
      enabled: true,
      clock: () => nowMs,
      nudgeCooldownMinutes: 30,
    });
    const medEnergy: EnergyEstimate = { level: 'medium', score: 0.5, reasons: [] };
    // lastNudgeTs 35 minutes ago → cooldown expired
    const p = ab.proactivity('u1', {
      deadlineNearMin: 30,
      energy: medEnergy,
      lastNudgeTs: nowMs - 35 * 60_000,
    });
    expect(p.shouldNudge).toBe(true);
  });

  it('cooldownMinutes reflects options.nudgeCooldownMinutes', () => {
    const ab = createAdaptiveBehavior({ enabled: true, nudgeCooldownMinutes: 45 });
    const p = ab.proactivity('u1');
    expect(p.cooldownMinutes).toBe(45);
  });
});

// ── save / load / reset ───────────────────────────────────────────────────────

describe('persistence', () => {
  it('save + load round-trip preserves events', async () => {
    const f = await tmpFile();
    const ab = createAdaptiveBehavior({ enabled: true, storeFile: f });
    ab.recordEvent(makeEvent('u1', 1000));
    ab.recordEvent(makeEvent('u1', 2000));
    ab.recordEvent(makeEvent('u2', 3000));
    ab.save();

    const ab2 = createAdaptiveBehavior({ enabled: true, storeFile: f });
    ab2.load();
    expect(ab2.events('u1')).toHaveLength(2);
    expect(ab2.events('u2')).toHaveLength(1);
    expect(ab2.events('u1')[0].ts).toBe(1000);
  });

  it('save without storeFile → no-op (no throw)', () => {
    const ab = createAdaptiveBehavior({ enabled: true }); // no storeFile
    ab.recordEvent(makeEvent('u1', Date.now()));
    expect(() => ab.save()).not.toThrow();
  });

  it('save is a no-op when disabled', async () => {
    const f = await tmpFile();
    const ab = createAdaptiveBehavior({ storeFile: f }); // disabled
    ab.recordEvent(makeEvent('u1', 1000)); // no-op since disabled
    ab.save(); // also no-op
    // file should not exist
    const exists = await fsp.access(f).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('load tolerates missing file (no throw)', async () => {
    const f = await tmpFile('missing.json');
    const ab = createAdaptiveBehavior({ enabled: true, storeFile: f });
    expect(() => ab.load()).not.toThrow();
    expect(ab.events('u1')).toHaveLength(0);
  });

  it('load tolerates corrupt file (no throw)', async () => {
    const f = await tmpFile();
    await fsp.writeFile(f, 'not valid json {{{{', 'utf8');
    const ab = createAdaptiveBehavior({ enabled: true, storeFile: f });
    expect(() => ab.load()).not.toThrow();
    expect(ab.events('u1')).toHaveLength(0);
  });

  it('load works regardless of enabled state (pre-load pattern)', async () => {
    const f = await tmpFile();
    // Save with first instance (enabled)
    const ab1 = createAdaptiveBehavior({ enabled: true, storeFile: f });
    ab1.recordEvent(makeEvent('u1', 999));
    ab1.save();

    // Load with disabled instance, then enable and verify
    const ab2 = createAdaptiveBehavior({ storeFile: f }); // disabled
    ab2.load();
    ab2.enable();
    expect(ab2.events('u1')).toHaveLength(1);
    expect(ab2.events('u1')[0].ts).toBe(999);
  });
});

describe('reset', () => {
  it('reset(userId) clears that user only', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('alice', 1));
    ab.recordEvent(makeEvent('bob', 2));
    ab.reset('alice');
    expect(ab.events('alice')).toHaveLength(0);
    expect(ab.events('bob')).toHaveLength(1);
  });

  it('reset() with no argument clears all users', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('alice', 1));
    ab.recordEvent(makeEvent('bob', 2));
    ab.reset();
    expect(ab.events('alice')).toHaveLength(0);
    expect(ab.events('bob')).toHaveLength(0);
  });

  it('reset works regardless of enabled state', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('u1', 1));
    ab.disable();
    ab.reset('u1'); // should still clear
    ab.enable();
    expect(ab.events('u1')).toHaveLength(0);
  });
});

// ── events() getter ───────────────────────────────────────────────────────────

describe('events()', () => {
  it('returns empty array when disabled', () => {
    const ab = createAdaptiveBehavior();
    expect(ab.events('u1')).toEqual([]);
  });

  it('sinceMs filter works', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    ab.recordEvent(makeEvent('u1', 1000));
    ab.recordEvent(makeEvent('u1', 5000));
    ab.recordEvent(makeEvent('u1', 9000));
    expect(ab.events('u1', { sinceMs: 4000 })).toHaveLength(2);
  });

  it('limit returns tail of events', () => {
    const ab = createAdaptiveBehavior({ enabled: true });
    for (let i = 0; i < 10; i++) ab.recordEvent(makeEvent('u1', i * 1000));
    const last3 = ab.events('u1', { limit: 3 });
    expect(last3).toHaveLength(3);
    expect(last3[2].ts).toBe(9000);
  });
});
