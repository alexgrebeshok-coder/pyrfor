/**
 * adaptive-behavior.ts — Pyrfor Adaptive Behavior module (G+11).
 *
 * Privacy-respecting, opt-in.  Tracks user activity schedule, infers
 * energy/sentiment heuristics, and exposes tone presets and proactivity
 * flags that downstream system-prompt builders can consult.
 *
 * OPT-IN: `enabled` defaults to false.  All mutating methods are no-ops
 * when disabled; getters return safe defaults.
 *
 * PERSISTENCE:
 *   save() writes JSON atomically (tmp-then-rename, sync).
 *   load() is tolerant: missing or corrupt file → silently initialises empty.
 *   Both operate on caller-provided storeFile; no-op when storeFile is absent.
 *
 * ENERGY FORMULA:
 *   Piecewise-linear time-of-day curve: nadir 0.0 at 3 am, peak 1.0 at 10 am,
 *   linearly rising over 7 h then linearly decaying over 17 h back to nadir.
 *   Combined with optional voice-rate factor (normalised to 140 wpm baseline)
 *   and task-density factor (normalised, saturation at 10 events / hr).
 *   Weights: tod 0.4/0.5, voice 0.3/0.5, density 0.3/0.5 (adjusted when
 *   only one signal is available).
 *
 * WAKE / SLEEP HEURISTIC:
 *   wakeHour  = first hour ≥ 4 am where normalised hourly > 0.3.
 *   sleepHour = last hour where normalised hourly > 0.3 (searching backward
 *   from 23).  Both fall back to 8 / 23 on degenerate (all-zero) input.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ActivityEvent {
  ts: number;
  userId: string;
  kind: 'message' | 'voice' | 'completion' | 'task_start' | 'task_end' | 'idle';
  meta?: {
    durationMs?: number;
    voiceRateWpm?: number;
    sentiment?: 'pos' | 'neu' | 'neg';
    taskDensity?: number;
  };
}

export interface ScheduleProfile {
  /** Per hour-of-day (0-23) probability that user is active (0..1). */
  hourly: number[];
  /** Per weekday (0=Sun..6=Sat) probability that user is active that day (0..1). */
  weekly: number[];
  wakeHour: number;
  sleepHour: number;
  totalEvents: number;
  updatedAt: string;
}

export interface EnergyEstimate {
  level: 'low' | 'medium' | 'high';
  /** Continuous score 0..1. */
  score: number;
  reasons: string[];
}

export interface ToneProfile {
  preset: 'terse' | 'neutral' | 'detailed' | 'caring';
  reason: string;
}

export interface ProactivityFlags {
  shouldNudge: boolean;
  reason: string;
  cooldownMinutes: number;
}

export interface AdaptiveBehaviorOptions {
  /** Default false — opt-in. */
  enabled?: boolean;
  /** Absolute path to the JSON store file.  No-op when absent. */
  storeFile?: string;
  /** Override wall clock (epoch ms).  Useful for testing. */
  clock?: () => number;
  /** Hours 0..morningEndHour are considered "morning".  Default 11. */
  morningEndHour?: number;
  /** Hours >= eveningStartHour are considered "evening".  Default 19. */
  eveningStartHour?: number;
  /** Minimum recorded events before schedule inference is meaningful.  Default 50. */
  minEventsForSchedule?: number;
  /** Minimum gap between nudges in minutes.  Default 30. */
  nudgeCooldownMinutes?: number;
}

export interface AdaptiveBehavior {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  recordEvent(e: ActivityEvent): void;
  schedule(userId: string): ScheduleProfile;
  energy(
    userId: string,
    ctx?: { recentEvents?: ActivityEvent[]; currentTaskDensity?: number },
  ): EnergyEstimate;
  tone(
    userId: string,
    ctx?: {
      sentiment?: 'pos' | 'neu' | 'neg';
      energy?: EnergyEstimate;
      deadlineNearMin?: number;
    },
  ): ToneProfile;
  proactivity(
    userId: string,
    ctx?: { lastNudgeTs?: number; deadlineNearMin?: number; energy?: EnergyEstimate },
  ): ProactivityFlags;
  events(userId: string, opts?: { sinceMs?: number; limit?: number }): ActivityEvent[];
  load(): void;
  save(): void;
  reset(userId?: string): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_EVENTS_PER_USER = 5_000;
const DEFAULT_MORNING_END_HOUR = 11;
const DEFAULT_EVENING_START_HOUR = 19;
const DEFAULT_MIN_EVENTS = 50;
const DEFAULT_NUDGE_COOLDOWN_MINUTES = 30;
const VOICE_RATE_BASELINE_WPM = 140;
const TASK_DENSITY_SATURATION = 10;

// TOD curve: nadir at 3 am (0.0), peak at 10 am (1.0).
const TOD_NADIR_HOUR = 3;
const TOD_PEAK_HOUR = 10;
const TOD_RISE_HOURS = ((TOD_PEAK_HOUR - TOD_NADIR_HOUR + 24) % 24); // 7
const TOD_DECAY_HOURS = 24 - TOD_RISE_HOURS;                          // 17

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Given a normalised hourly-activity array (24 values 0..1), return the
 * estimated wake hour and sleep hour.
 *
 * Wake:  first hour starting from 4 am (inclusive, wrapping) where value > 0.3.
 * Sleep: last hour (searching backward from 23) where value > 0.3.
 * Fallback: wake=8, sleep=23 when no hour exceeds the threshold.
 */
export function inferWakeSleep(hourly: number[]): { wakeHour: number; sleepHour: number } {
  const THRESHOLD = 0.3;
  const WAKE_SEARCH_START = 4;

  if (!Array.isArray(hourly) || hourly.length < 24) {
    return { wakeHour: 8, sleepHour: 23 };
  }

  let wakeHour = -1;
  for (let i = 0; i < 24; i++) {
    const h = (WAKE_SEARCH_START + i) % 24;
    if ((hourly[h] ?? 0) > THRESHOLD) {
      wakeHour = h;
      break;
    }
  }

  let sleepHour = -1;
  for (let h = 23; h >= 0; h--) {
    if ((hourly[h] ?? 0) > THRESHOLD) {
      sleepHour = h;
      break;
    }
  }

  return {
    wakeHour: wakeHour === -1 ? 8 : wakeHour,
    sleepHour: sleepHour === -1 ? 23 : sleepHour,
  };
}

/**
 * Classify a continuous energy score into a discrete level.
 * score < 0.34 → low, < 0.67 → medium, else high.
 */
export function classifyEnergy(score: number): 'low' | 'medium' | 'high' {
  if (score < 0.34) return 'low';
  if (score < 0.67) return 'medium';
  return 'high';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Safe UTC-hour extraction guarding against overflow. */
function safeHour(ts: number): number {
  const h = new Date(ts).getUTCHours();
  return (((h % 24) + 24) % 24);
}

/** Safe UTC day-of-week extraction (0=Sun..6=Sat). */
function safeDay(ts: number): number {
  return new Date(ts).getUTCDay();
}

/**
 * Piecewise-linear time-of-day factor: 0.0 at 3 am, 1.0 at 10 am.
 * Rises linearly for 7 h (nadir→peak), decays linearly for 17 h (peak→nadir).
 */
function computeTodFactor(h: number): number {
  const offset = (((h - TOD_NADIR_HOUR) % 24) + 24) % 24;
  if (offset <= TOD_RISE_HOURS) {
    return offset / TOD_RISE_HOURS;
  }
  return (24 - offset) / TOD_DECAY_HOURS;
}

// ── Atomic sync write (tmp + rename) ─────────────────────────────────────────

function atomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${randomBytes(4).toString('hex')}`,
  );
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, filePath);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

// ── Safe defaults ─────────────────────────────────────────────────────────────

function defaultSchedule(): ScheduleProfile {
  return {
    hourly: Array<number>(24).fill(0),
    weekly: Array<number>(7).fill(0),
    wakeHour: 8,
    sleepHour: 23,
    totalEvents: 0,
    updatedAt: new Date().toISOString(),
  };
}

function defaultEnergy(): EnergyEstimate {
  return { level: 'medium', score: 0.5, reasons: ['module disabled'] };
}

function defaultTone(): ToneProfile {
  return { preset: 'neutral', reason: 'module disabled' };
}

function defaultProactivity(cooldownMinutes: number): ProactivityFlags {
  return { shouldNudge: false, reason: 'module disabled', cooldownMinutes };
}

// ── Serialised store shape ────────────────────────────────────────────────────

interface StoreData {
  events: Record<string, ActivityEvent[]>;
}

// ── createAdaptiveBehavior ────────────────────────────────────────────────────

export function createAdaptiveBehavior(opts?: AdaptiveBehaviorOptions): AdaptiveBehavior {
  let _enabled = opts?.enabled ?? false;
  const storeFile = opts?.storeFile;
  const clock = opts?.clock ?? (() => Date.now());
  const morningEndHour = opts?.morningEndHour ?? DEFAULT_MORNING_END_HOUR;
  const eveningStartHour = opts?.eveningStartHour ?? DEFAULT_EVENING_START_HOUR;
  const minEventsForSchedule = opts?.minEventsForSchedule ?? DEFAULT_MIN_EVENTS;
  const nudgeCooldownMinutes = opts?.nudgeCooldownMinutes ?? DEFAULT_NUDGE_COOLDOWN_MINUTES;

  const _userEvents = new Map<string, ActivityEvent[]>();

  // ── internal helpers ───────────────────────────────────────────────────────

  function getUserEvents(userId: string): ActivityEvent[] {
    let arr = _userEvents.get(userId);
    if (!arr) {
      arr = [];
      _userEvents.set(userId, arr);
    }
    return arr;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function isEnabled(): boolean {
    return _enabled;
  }

  function enable(): void {
    _enabled = true;
  }

  function disable(): void {
    _enabled = false;
  }

  function recordEvent(e: ActivityEvent): void {
    if (!_enabled) return;
    const arr = getUserEvents(e.userId);
    arr.push(e);
    if (arr.length > MAX_EVENTS_PER_USER) {
      arr.splice(0, arr.length - MAX_EVENTS_PER_USER);
    }
  }

  function schedule(userId: string): ScheduleProfile {
    if (!_enabled) return defaultSchedule();

    const evts = getUserEvents(userId);
    const totalEvents = evts.length;

    if (totalEvents < minEventsForSchedule) {
      return { ...defaultSchedule(), totalEvents };
    }

    const hourlyCounts = Array<number>(24).fill(0);
    const weeklyCounts = Array<number>(7).fill(0);

    for (const e of evts) {
      hourlyCounts[safeHour(e.ts)]++;
      weeklyCounts[safeDay(e.ts)]++;
    }

    const maxH = Math.max(...hourlyCounts);
    const maxW = Math.max(...weeklyCounts);

    const hourly = hourlyCounts.map(c => (maxH > 0 ? c / maxH : 0));
    const weekly = weeklyCounts.map(c => (maxW > 0 ? c / maxW : 0));
    const { wakeHour, sleepHour } = inferWakeSleep(hourly);

    return {
      hourly,
      weekly,
      wakeHour,
      sleepHour,
      totalEvents,
      updatedAt: new Date().toISOString(),
    };
  }

  function energy(
    userId: string,
    ctx?: { recentEvents?: ActivityEvent[]; currentTaskDensity?: number },
  ): EnergyEstimate {
    if (!_enabled) return defaultEnergy();

    const now = clock();
    const h = safeHour(now);
    const tod = computeTodFactor(h);
    const reasons: string[] = [];

    // --- voice-rate signal ---
    let voiceScore: number | null = null;
    const voiceEvts = (ctx?.recentEvents ?? []).filter(
      e => e.kind === 'voice' && e.meta?.voiceRateWpm != null,
    );
    if (voiceEvts.length > 0) {
      const avgWpm =
        voiceEvts.reduce((s, e) => s + (e.meta!.voiceRateWpm as number), 0) /
        voiceEvts.length;
      voiceScore = Math.min(1, avgWpm / VOICE_RATE_BASELINE_WPM);
    }

    // --- task-density signal ---
    let densityScore: number | null = null;
    if (ctx?.currentTaskDensity != null) {
      densityScore = Math.min(1, ctx.currentTaskDensity / TASK_DENSITY_SATURATION);
    } else {
      const recentEvts = getUserEvents(userId).filter(e => e.ts >= now - 3_600_000);
      if (recentEvts.length > 0) {
        densityScore = Math.min(1, recentEvts.length / TASK_DENSITY_SATURATION);
      }
    }

    // --- combine signals ---
    let score: number;
    if (voiceScore !== null && densityScore !== null) {
      score = tod * 0.4 + voiceScore * 0.3 + densityScore * 0.3;
    } else if (voiceScore !== null) {
      score = tod * 0.5 + voiceScore * 0.5;
    } else if (densityScore !== null) {
      score = tod * 0.5 + densityScore * 0.5;
    } else {
      score = tod;
    }

    score = Math.max(0, Math.min(1, score));

    // --- reasons ---
    if (tod < 0.3) reasons.push('early-morning fatigue');
    else if (tod > 0.7) reasons.push('peak-day hours');
    if (voiceScore !== null) {
      if (voiceScore > 0.7) reasons.push('fast voice rate');
      else if (voiceScore < 0.4) reasons.push('slow voice rate');
    }
    if (densityScore !== null) {
      if (densityScore > 0.6) reasons.push('high task density');
      else if (densityScore < 0.3) reasons.push('low task density');
    }
    if (reasons.length === 0) reasons.push('estimated from time-of-day');

    return { level: classifyEnergy(score), score, reasons };
  }

  function tone(
    userId: string,
    ctx?: {
      sentiment?: 'pos' | 'neu' | 'neg';
      energy?: EnergyEstimate;
      deadlineNearMin?: number;
    },
  ): ToneProfile {
    if (!_enabled) return defaultTone();

    const eng = ctx?.energy ?? energy(userId);
    const sentiment = ctx?.sentiment;
    const deadlineNearMin = ctx?.deadlineNearMin;
    const h = safeHour(clock());

    // Priority 1 — caring: user is exhausted or distressed.
    if (eng.level === 'low' || sentiment === 'neg') {
      return {
        preset: 'caring',
        reason: eng.level === 'low' ? 'low energy detected' : 'negative sentiment detected',
      };
    }

    // Priority 2 — terse: morning rush or imminent deadline.
    if (h <= morningEndHour || (deadlineNearMin != null && deadlineNearMin <= 15)) {
      const reason =
        deadlineNearMin != null && deadlineNearMin <= 15 ? 'deadline imminent' : 'morning hours';
      return { preset: 'terse', reason };
    }

    // Priority 3 — detailed: relaxed evening session.
    if (h >= eveningStartHour) {
      return { preset: 'detailed', reason: 'evening hours' };
    }

    return { preset: 'neutral', reason: 'normal working hours' };
  }

  function proactivity(
    userId: string,
    ctx?: { lastNudgeTs?: number; deadlineNearMin?: number; energy?: EnergyEstimate },
  ): ProactivityFlags {
    if (!_enabled) return defaultProactivity(nudgeCooldownMinutes);

    const eng = ctx?.energy ?? energy(userId);
    const { deadlineNearMin, lastNudgeTs } = ctx ?? {};
    const now = clock();
    const cooldownMs = nudgeCooldownMinutes * 60_000;

    if (eng.level === 'low') {
      return {
        shouldNudge: false,
        reason: 'low energy — avoid nudge',
        cooldownMinutes: nudgeCooldownMinutes,
      };
    }

    if (deadlineNearMin == null || deadlineNearMin > 60) {
      return {
        shouldNudge: false,
        reason: 'no imminent deadline',
        cooldownMinutes: nudgeCooldownMinutes,
      };
    }

    if (lastNudgeTs != null && now - lastNudgeTs < cooldownMs) {
      return {
        shouldNudge: false,
        reason: 'within cooldown window',
        cooldownMinutes: nudgeCooldownMinutes,
      };
    }

    return {
      shouldNudge: true,
      reason: 'deadline approaching and user is active',
      cooldownMinutes: nudgeCooldownMinutes,
    };
  }

  function events(
    userId: string,
    opts?: { sinceMs?: number; limit?: number },
  ): ActivityEvent[] {
    if (!_enabled) return [];
    let evts = [...getUserEvents(userId)];
    if (opts?.sinceMs != null) {
      evts = evts.filter(e => e.ts >= (opts.sinceMs as number));
    }
    if (opts?.limit != null) {
      evts = evts.slice(-opts.limit);
    }
    return evts;
  }

  /**
   * Restore state from storeFile.  Always runs (not gated by enabled) so
   * callers can pre-load data before calling enable().
   */
  function load(): void {
    if (!storeFile) return;
    _userEvents.clear();
    try {
      const raw = readFileSync(storeFile, 'utf8');
      const data = JSON.parse(raw) as StoreData;
      if (data && typeof data === 'object' && Array.isArray !== undefined && data.events) {
        for (const [userId, evts] of Object.entries(data.events)) {
          if (Array.isArray(evts)) {
            _userEvents.set(userId, evts);
          }
        }
      }
    } catch {
      // missing or corrupt → stay empty
    }
  }

  /**
   * Persist in-memory events atomically (tmp + rename).
   * No-op when disabled or when no storeFile was provided.
   */
  function save(): void {
    if (!_enabled) return;
    if (!storeFile) return;
    const eventsRecord: Record<string, ActivityEvent[]> = {};
    for (const [userId, evts] of _userEvents.entries()) {
      eventsRecord[userId] = evts;
    }
    const data: StoreData = { events: eventsRecord };
    atomicWriteSync(storeFile, JSON.stringify(data, null, 2));
  }

  /** Clear events for a specific user, or all users when called without argument. */
  function reset(userId?: string): void {
    if (userId !== undefined) {
      _userEvents.delete(userId);
    } else {
      _userEvents.clear();
    }
  }

  return {
    isEnabled,
    enable,
    disable,
    recordEvent,
    schedule,
    energy,
    tone,
    proactivity,
    events,
    load,
    save,
    reset,
  };
}
