/**
 * skill-effectiveness.ts — Pyrfor SkillEffectivenessTracker (G+4).
 *
 * Tracks per-skill usage, success/failure/partial outcomes, mean latency, and
 * last-used timestamp.  Persists to a JSON file atomically (tmp + renameSync).
 * Exposes pickBest() for epsilon-greedy skill selection based on proven track
 * records.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SkillEffectivenessRecord {
  skillId: string;
  skillName: string;
  uses: number;
  successes: number;
  failures: number;
  partials: number;
  totalLatencyMs: number;
  meanLatencyMs: number;
  lastUsedAt?: string;
  lastOutcome?: 'success' | 'failure' | 'partial';
  tags?: string[];
  /** Exponential moving average of success rate (0..1), alpha=0.3. Initial=0.5. */
  ema: number;
}

export interface RecordOutcomeInput {
  skillId: string;
  skillName: string;
  outcome: 'success' | 'failure' | 'partial';
  latencyMs: number;
  tags?: string[];
  timestamp?: string;
}

export interface PickBestOptions {
  /** Only candidates with uses >= minUses are eligible.  Default: 0. */
  minUses?: number;
  /** Epsilon-greedy exploration rate.  Default: 0.1.  Clamped to [0, 1]. */
  explorationRate?: number;
  /** Filter out records whose score < minScore.  Default: 0. */
  minScore?: number;
  /** Custom scoring function.  Default: ema*0.7 + recency*0.2 + latency*0.1. */
  scoreFn?: (r: SkillEffectivenessRecord) => number;
  /** RNG override (for testing).  Default: Math.random. */
  rng?: () => number;
  /** Clock override (ms since epoch).  Default: Date.now. */
  clock?: () => number;
}

export interface SkillEffectivenessTracker {
  recordOutcome(input: RecordOutcomeInput): SkillEffectivenessRecord;
  get(skillId: string): SkillEffectivenessRecord | undefined;
  list(): SkillEffectivenessRecord[];
  pickBest<T extends { id: string; name?: string }>(
    candidates: T[],
    opts?: PickBestOptions,
  ): T | undefined;
  rank(opts?: PickBestOptions): SkillEffectivenessRecord[];
  reset(skillId?: string): void;
  flush(): Promise<void>;
}

export interface CreateSkillEffectivenessTrackerOptions {
  /** JSON file path.  If omitted the tracker is in-memory only. */
  storePath?: string;
  /** EMA smoothing factor.  Default: 0.3. */
  alpha?: number;
  /** Clock override (ms since epoch).  Default: Date.now. */
  clock?: () => number;
  /** Debounce delay for background flushes.  Default: 200 ms. */
  flushDebounceMs?: number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

// ── Atomic write helper ───────────────────────────────────────────────────────

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
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

// ── Default score function ────────────────────────────────────────────────────

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
}

function buildDefaultScoreFn(clock: () => number): (r: SkillEffectivenessRecord) => number {
  return (r: SkillEffectivenessRecord): number => {
    const emaScore = r.ema * 0.7;

    let recencyScore = 0.2; // no lastUsedAt → treat as brand-new (neutral)
    if (r.lastUsedAt) {
      const daysOld = (clock() - new Date(r.lastUsedAt).getTime()) / 86_400_000;
      recencyScore = (1 - clamp(0, 1, daysOld / 30)) * 0.2;
    }

    const latencyScore = (1 / (1 + r.meanLatencyMs / 1000)) * 0.1;

    return emaScore + recencyScore + latencyScore;
  };
}

// ── Zero-usage synthetic record helper ───────────────────────────────────────

function syntheticRecord(id: string, name?: string): SkillEffectivenessRecord {
  return {
    skillId: id,
    skillName: name ?? id,
    uses: 0,
    successes: 0,
    failures: 0,
    partials: 0,
    totalLatencyMs: 0,
    meanLatencyMs: 0,
    ema: 0.5,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSkillEffectivenessTracker(
  opts?: CreateSkillEffectivenessTrackerOptions,
): SkillEffectivenessTracker {
  const {
    storePath,
    alpha = 0.3,
    clock = () => Date.now(),
    flushDebounceMs = 200,
    logger,
  } = opts ?? {};

  const _records = new Map<string, SkillEffectivenessRecord>();
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const defaultScoreFn = buildDefaultScoreFn(clock);

  // ── Load from disk ────────────────────────────────────────────────────────

  if (storePath) {
    try {
      const raw = readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw) as SkillEffectivenessRecord[];
      if (Array.isArray(parsed)) {
        for (const rec of parsed) {
          _records.set(rec.skillId, rec);
        }
      }
    } catch (err: unknown) {
      const isMissing =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!isMissing) {
        logger?.('warn', '[SkillEffectivenessTracker] Bad JSON in storePath; starting fresh.', {
          storePath,
          err,
        });
      }
    }
  }

  // ── Flush ─────────────────────────────────────────────────────────────────

  async function flush(): Promise<void> {
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    if (!storePath) return;
    const items = Array.from(_records.values());
    atomicWriteSync(storePath, JSON.stringify(items, null, 2));
  }

  function scheduledFlush(): void {
    if (!storePath) return;
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      const items = Array.from(_records.values());
      try {
        atomicWriteSync(storePath, JSON.stringify(items, null, 2));
      } catch (err) {
        logger?.('error', '[SkillEffectivenessTracker] Debounced flush failed.', { err });
      }
    }, flushDebounceMs);
  }

  // ── recordOutcome ─────────────────────────────────────────────────────────

  function recordOutcome(input: RecordOutcomeInput): SkillEffectivenessRecord {
    const latencyMs = Math.max(0, input.latencyMs);

    let rec = _records.get(input.skillId);
    if (!rec) {
      rec = {
        skillId: input.skillId,
        skillName: input.skillName,
        uses: 0,
        successes: 0,
        failures: 0,
        partials: 0,
        totalLatencyMs: 0,
        meanLatencyMs: 0,
        ema: 0.5,
        tags: [],
      };
    }

    rec.uses += 1;
    if (input.outcome === 'success') rec.successes += 1;
    else if (input.outcome === 'failure') rec.failures += 1;
    else rec.partials += 1;

    rec.totalLatencyMs += latencyMs;
    rec.meanLatencyMs = rec.totalLatencyMs / rec.uses;

    rec.lastUsedAt = input.timestamp ?? new Date(clock()).toISOString();
    rec.lastOutcome = input.outcome;

    // EMA: x=1 for success, 0 for failure, 0.5 for partial
    const x = input.outcome === 'success' ? 1 : input.outcome === 'failure' ? 0 : 0.5;
    rec.ema = alpha * x + (1 - alpha) * rec.ema;

    // Merge tags: deduped, capped at 10
    if (input.tags && input.tags.length > 0) {
      const existing = new Set(rec.tags ?? []);
      for (const t of input.tags) {
        existing.add(t);
      }
      rec.tags = Array.from(existing).slice(0, 10);
    }

    _records.set(rec.skillId, rec);
    scheduledFlush();
    return rec;
  }

  // ── get / list ────────────────────────────────────────────────────────────

  function get(skillId: string): SkillEffectivenessRecord | undefined {
    return _records.get(skillId);
  }

  function list(): SkillEffectivenessRecord[] {
    return Array.from(_records.values());
  }

  // ── rank ──────────────────────────────────────────────────────────────────

  function rank(rankOpts?: PickBestOptions): SkillEffectivenessRecord[] {
    const scoreFn = rankOpts?.scoreFn ?? defaultScoreFn;
    const clockFn = rankOpts?.clock ?? clock;
    const effectiveScoreFn = rankOpts?.scoreFn
      ? scoreFn
      : buildDefaultScoreFn(clockFn);

    return Array.from(_records.values())
      .slice()
      .sort((a, b) => effectiveScoreFn(b) - effectiveScoreFn(a));
  }

  // ── pickBest ──────────────────────────────────────────────────────────────

  function pickBest<T extends { id: string; name?: string }>(
    candidates: T[],
    pickOpts?: PickBestOptions,
  ): T | undefined {
    if (candidates.length === 0) return undefined;

    const minUses = pickOpts?.minUses ?? 0;
    const explorationRate = clamp(0, 1, pickOpts?.explorationRate ?? 0.1);
    const minScore = pickOpts?.minScore ?? 0;
    const rng = pickOpts?.rng ?? Math.random;
    const clockFn = pickOpts?.clock ?? clock;
    const scoreFn = pickOpts?.scoreFn ?? buildDefaultScoreFn(clockFn);

    // Build (candidate, record, score) tuples for eligible candidates
    const eligible: Array<{ candidate: T; score: number }> = [];

    for (const c of candidates) {
      const rec = _records.get(c.id) ?? syntheticRecord(c.id, c.name);
      if (rec.uses < minUses) continue;
      const score = scoreFn(rec);
      if (score < minScore) continue;
      eligible.push({ candidate: c, score });
    }

    if (eligible.length === 0) return undefined;

    // Epsilon-greedy: explore uniformly from eligible, or exploit top score
    if (rng() < explorationRate) {
      const idx = Math.floor(rng() * eligible.length);
      return eligible[idx]?.candidate ?? eligible[0]!.candidate;
    }

    // Exploit: pick highest score (stable: preserves original index on tie)
    let best = eligible[0]!;
    for (let i = 1; i < eligible.length; i++) {
      if (eligible[i]!.score > best.score) {
        best = eligible[i]!;
      }
    }
    return best.candidate;
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  function reset(skillId?: string): void {
    if (skillId !== undefined) {
      _records.delete(skillId);
    } else {
      _records.clear();
    }
    scheduledFlush();
  }

  return { recordOutcome, get, list, pickBest, rank, reset, flush };
}
