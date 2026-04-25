/**
 * skill-tracker.ts — Pyrfor self-improvement: skill-effectiveness tracker.
 *
 * Tracks every invocation of a skill in a pipeline, persists invocations to
 * day-rotated JSONL files, and provides a `recompute()` routine (intended to
 * run nightly) that updates each skill's weight based on its success/failure
 * ratio and auto-archives consistently-failing skills.
 *
 * PERSISTENCE MODEL (best-effort):
 *   - A call to `beginInvocation` stores the in-flight record in memory only.
 *   - `endInvocation` appends the completed record as one JSON line to
 *     `{baseDir}/{YYYY-MM-DD}.jsonl` and calls `synth.recordUsage`.
 *   - If the process dies between begin and end, that invocation is silently
 *     lost.  This is intentional for v1 — counters are advisory signals, not
 *     audit logs.
 *
 * CONCURRENCY:
 *   - A per-file Mutex serialises concurrent appends to the same JSONL file,
 *     preventing interleaved writes from producing malformed lines.
 *
 * AUTO-ARCHIVE POLICY:
 *   Auto-archive applies to *any* non-archived skill (including 'proposed')
 *   when successRate < autoArchiveThreshold AND applied_count >= minSamples.
 *   Rationale: even proposed skills can exhibit catastrophic failure patterns
 *   during shadow-testing and should be archived proactively.
 */

import { promises as fsp } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { logger } from '../observability/logger.js';
import type { SkillSynthesizer, SkillStatus } from './skill-synth.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface SkillInvocation {
  skillSlug: string;
  sessionId: string;
  trajectoryId: string;
  /** ISO timestamp set by beginInvocation. */
  startedAt: string;
  /** ISO timestamp set by endInvocation. */
  finishedAt?: string;
  success?: boolean;
  errorMessage?: string;
  durationMs?: number;
}

export interface SkillStats {
  slug: string;
  applied_count: number;
  success_count: number;
  failure_count: number;
  /** 0..1; NaN when applied_count === 0. */
  successRate: number;
  weight: number;
  status: SkillStatus;
  /** Count of consecutive failures from the most recent invocation. */
  recentFailureStreak: number;
}

export type WeightFnInput = Pick<
  SkillStats,
  'applied_count' | 'success_count' | 'failure_count'
>;

export interface SkillTrackerOptions {
  /** Root directory for day-rotated JSONL files.  Default: ~/.pyrfor/skill-invocations */
  baseDir: string;
  synth: SkillSynthesizer;
  /**
   * Skills whose successRate < this value AND applied_count >= minSamples
   * will be automatically archived during recompute().  Default: 0.2.
   */
  autoArchiveThreshold?: number;
  /** Minimum observations required before a skill can be auto-archived.  Default: 10. */
  minSamples?: number;
  /**
   * Custom weight formula.
   * Default: clamp(0, 1,  log10(applied+1)/2  *  (0.3 + 0.7*successRate))
   * Returns 0.5 when applied_count === 0 (neutral starting weight).
   */
  weightFn?: (stats: WeightFnInput) => number;
}

// ── Per-file mutex ────────────────────────────────────────────────────────────

class Mutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => {
            this._locked = false;
            const next = this._queue.shift();
            if (next) next();
          });
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

// ── Default weight function ───────────────────────────────────────────────────

/**
 * Computes a [0, 1] weight that balances usage frequency and success rate.
 *
 * Formula:  clamp(0, 1,  log10(applied+1)/2  *  (0.3 + 0.7 * successRate))
 * Rationale:
 *   - A brand-new skill (0 samples) gets a neutral weight of 0.5.
 *   - Frequency factor saturates at 1 once applied_count reaches ~99.
 *   - Even a perfectly successful skill never exceeds 1.0.
 *   - A skill with 0% success rate converges toward 0.3 * freq (near-zero).
 */
export function defaultWeightFn({ applied_count, success_count }: WeightFnInput): number {
  if (applied_count === 0) return 0.5;
  const sr = success_count / applied_count;
  const freq = Math.min(1, Math.log10(applied_count + 1) / 2);
  return Math.max(0, Math.min(1, freq * (0.3 + 0.7 * sr)));
}

// ── ULID-like ID generation ───────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

// ── JSONL path helpers ────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function jsonlPath(baseDir: string, dateKey: string): string {
  return path.join(baseDir, `${dateKey}.jsonl`);
}

// ── SkillTracker ──────────────────────────────────────────────────────────────

export class SkillTracker {
  private readonly baseDir: string;
  private readonly synth: SkillSynthesizer;
  private readonly autoArchiveThreshold: number;
  private readonly minSamples: number;
  private readonly weightFn: (stats: WeightFnInput) => number;

  /** In-flight invocations (begun but not yet ended).  Lost on process death. */
  private readonly _pending = new Map<string, SkillInvocation>();

  /** Per-file mutexes for safe concurrent JSONL appends. */
  private readonly _mutexes = new Map<string, Mutex>();

  constructor(opts: SkillTrackerOptions) {
    this.baseDir = opts.baseDir;
    this.synth = opts.synth;
    this.autoArchiveThreshold = opts.autoArchiveThreshold ?? 0.2;
    this.minSamples = opts.minSamples ?? 10;
    this.weightFn = opts.weightFn ?? defaultWeightFn;
  }

  private _getMutex(fp: string): Mutex {
    let m = this._mutexes.get(fp);
    if (!m) {
      m = new Mutex();
      this._mutexes.set(fp, m);
    }
    return m;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Begin tracking an invocation.
   * Returns a unique invocation id (ULID-like: time-base36 + 10-byte hex).
   * The in-flight record is kept in memory until endInvocation is called.
   */
  async beginInvocation(input: Omit<SkillInvocation, 'startedAt'>): Promise<string> {
    const id = generateId();
    if (this._pending.has(id)) {
      // Astronomically unlikely with crypto entropy, but guard defensively.
      throw new Error(`[SkillTracker] Invocation id collision: ${id}`);
    }
    this._pending.set(id, {
      ...input,
      startedAt: new Date().toISOString(),
    });
    return id;
  }

  /**
   * Mark an invocation finished: persists the completed record to JSONL and
   * propagates success/failure to the skill's counters via synth.recordUsage.
   *
   * If `id` is unknown (e.g. process restarted between begin and end), logs a
   * warning and returns without error — best-effort semantics.
   */
  async endInvocation(
    id: string,
    result: { success: boolean; errorMessage?: string },
  ): Promise<void> {
    const inv = this._pending.get(id);
    if (!inv) {
      logger.warn('[SkillTracker] endInvocation: unknown id (process restart?)', { id });
      return;
    }
    this._pending.delete(id);

    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(inv.startedAt).getTime();

    const completed: SkillInvocation = {
      skillSlug: inv.skillSlug,
      sessionId: inv.sessionId,
      trajectoryId: inv.trajectoryId,
      startedAt: inv.startedAt,
      finishedAt,
      success: result.success,
      errorMessage: result.errorMessage,
      durationMs,
    };

    // Persist to JSONL under per-file mutex (safe for concurrent callers).
    await fsp.mkdir(this.baseDir, { recursive: true });
    const fp = jsonlPath(this.baseDir, todayKey());
    const line = JSON.stringify(completed) + '\n';

    const release = await this._getMutex(fp).acquire();
    try {
      await fsp.appendFile(fp, line, 'utf8');
    } finally {
      release();
    }

    // Update in-file counters.
    await this.synth.recordUsage(completed.skillSlug, result.success);
  }

  /**
   * Recompute weights for all skills and auto-archive consistently-failing ones.
   *
   * Steps for each skill:
   *  1. If already archived → include in stats, skip further processing.
   *  2. If successRate < autoArchiveThreshold AND applied_count >= minSamples
   *     → archive via synth.updateStatus.
   *  3. If |newWeight − currentWeight| >= 0.05 → reload and save with newWeight.
   *
   * Returns counts of updated / archived skills plus full stats array.
   */
  async recompute(): Promise<{ updated: number; archived: number; stats: SkillStats[] }> {
    const skills = await this.synth.listAll();
    if (skills.length === 0) {
      return { updated: 0, archived: 0, stats: [] };
    }

    // Load all persisted invocations once so recentFailureStreak is cheap.
    const allInvocations = await this._readAllInvocations();

    let updated = 0;
    let archived = 0;
    const stats: SkillStats[] = [];

    for (const skill of skills) {
      const fm = skill.frontmatter;
      const slug = fm.name;
      const streak = this._computeStreak(allInvocations, slug);
      const successRate = fm.applied_count > 0 ? fm.success_count / fm.applied_count : NaN;

      // Already-archived skills are reported as-is.
      if (fm.status === 'archived') {
        stats.push({
          slug,
          applied_count: fm.applied_count,
          success_count: fm.success_count,
          failure_count: fm.failure_count,
          successRate,
          weight: fm.weight,
          status: 'archived',
          recentFailureStreak: streak,
        });
        continue;
      }

      // Auto-archive check (applies to any non-archived status).
      if (!isNaN(successRate) && successRate < this.autoArchiveThreshold && fm.applied_count >= this.minSamples) {
        await this.synth.updateStatus(slug, 'archived');
        archived++;
        stats.push({
          slug,
          applied_count: fm.applied_count,
          success_count: fm.success_count,
          failure_count: fm.failure_count,
          successRate,
          weight: fm.weight,
          status: 'archived',
          recentFailureStreak: streak,
        });
        continue;
      }

      // Weight recomputation.
      const newWeight = this.weightFn({
        applied_count: fm.applied_count,
        success_count: fm.success_count,
        failure_count: fm.failure_count,
      });

      if (Math.abs(newWeight - fm.weight) >= 0.05) {
        // Reload the file to get the freshest frontmatter (recordUsage may
        // have modified counters since listAll() was called above).
        const fresh = await this.synth.load(slug);
        if (fresh) {
          await this.synth.save({
            ...fresh,
            frontmatter: {
              ...fresh.frontmatter,
              weight: newWeight,
              updated_at: new Date().toISOString(),
            },
          });
          updated++;
        }
      }

      stats.push({
        slug,
        applied_count: fm.applied_count,
        success_count: fm.success_count,
        failure_count: fm.failure_count,
        successRate: isNaN(successRate) ? NaN : successRate,
        weight: newWeight,
        status: fm.status,
        recentFailureStreak: streak,
      });
    }

    return { updated, archived, stats };
  }

  /** Fetch the latest stats for one skill.  Returns null if the slug is unknown. */
  async getStats(slug: string): Promise<SkillStats | null> {
    const skill = await this.synth.load(slug);
    if (!skill) return null;

    const fm = skill.frontmatter;
    const allInvocations = await this._readAllInvocations();
    const successRate = fm.applied_count > 0 ? fm.success_count / fm.applied_count : NaN;

    return {
      slug,
      applied_count: fm.applied_count,
      success_count: fm.success_count,
      failure_count: fm.failure_count,
      successRate,
      weight: fm.weight,
      status: fm.status,
      recentFailureStreak: this._computeStreak(allInvocations, slug),
    };
  }

  /** Return stats for all skills, sorted by weight descending. */
  async listStats(): Promise<SkillStats[]> {
    const skills = await this.synth.listAll();
    const allInvocations = await this._readAllInvocations();

    const stats = skills.map((skill): SkillStats => {
      const fm = skill.frontmatter;
      const successRate = fm.applied_count > 0 ? fm.success_count / fm.applied_count : NaN;
      return {
        slug: fm.name,
        applied_count: fm.applied_count,
        success_count: fm.success_count,
        failure_count: fm.failure_count,
        successRate,
        weight: fm.weight,
        status: fm.status,
        recentFailureStreak: this._computeStreak(allInvocations, fm.name),
      };
    });

    return stats.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Query persisted invocations with optional filters.
   * Results are returned in chronological order (oldest first) before limiting.
   */
  async listInvocations(filter?: {
    slug?: string;
    since?: Date;
    until?: Date;
    success?: boolean;
    limit?: number;
  }): Promise<SkillInvocation[]> {
    let invocations = await this._readAllInvocations();

    if (filter?.slug !== undefined) {
      invocations = invocations.filter((inv) => inv.skillSlug === filter.slug);
    }
    if (filter?.since !== undefined) {
      const sinceMs = filter.since.getTime();
      invocations = invocations.filter((inv) => new Date(inv.startedAt).getTime() >= sinceMs);
    }
    if (filter?.until !== undefined) {
      const untilMs = filter.until.getTime();
      invocations = invocations.filter((inv) => new Date(inv.startedAt).getTime() <= untilMs);
    }
    if (filter?.success !== undefined) {
      invocations = invocations.filter((inv) => inv.success === filter.success);
    }
    if (filter?.limit !== undefined && filter.limit > 0) {
      invocations = invocations.slice(0, filter.limit);
    }

    return invocations;
  }

  /**
   * Delete JSONL files whose filename date is strictly older than `olderThanDays` days.
   * Non-JSONL files and files whose names do not parse as YYYY-MM-DD are skipped.
   * Returns the count of deleted files.
   */
  async pruneOld(olderThanDays: number): Promise<number> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.baseDir);
    } catch {
      return 0;
    }

    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const dateStr = entry.slice(0, -6); // strip ".jsonl"
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) continue;
      if (parsed.getTime() < cutoffMs) {
        try {
          await fsp.unlink(path.join(this.baseDir, entry));
          removed++;
        } catch {
          // best effort
        }
      }
    }

    return removed;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Read all JSONL files in baseDir; parse each line; sort chronologically. */
  private async _readAllInvocations(): Promise<SkillInvocation[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.baseDir);
    } catch {
      return [];
    }

    const results: SkillInvocation[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fp = path.join(this.baseDir, entry);
      let content: string;
      try {
        content = await fsp.readFile(fp, 'utf8');
      } catch {
        continue;
      }
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          results.push(JSON.parse(trimmed) as SkillInvocation);
        } catch {
          logger.warn('[SkillTracker] Malformed JSONL line skipped', {
            fp,
            preview: trimmed.slice(0, 80),
          });
        }
      }
    }

    results.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    return results;
  }

  /**
   * Count consecutive failures starting from the most recent invocation for a
   * given slug.  Inspects the last 20 completed invocations for that slug.
   * A streak is broken as soon as a success is encountered.
   */
  private _computeStreak(all: SkillInvocation[], slug: string): number {
    const forSlug = all
      .filter((inv) => inv.skillSlug === slug && inv.success !== undefined)
      .slice(-20); // last 20

    let streak = 0;
    for (let i = forSlug.length - 1; i >= 0; i--) {
      if (forSlug[i].success === false) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
}
