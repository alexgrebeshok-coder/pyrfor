/**
 * pattern-miner.ts — Pyrfor self-improvement: pattern mining over trajectories.
 *
 * Reads TrajectoryRecord streams, finds repeated tool-sequences, failure modes,
 * and user-corrections, then emits SkillCandidate objects for downstream synthesis.
 */

import crypto from 'crypto';
import type { TrajectoryRecord } from './trajectory';

export type { TrajectoryRecord };

// ── Public types ───────────────────────────────────────────────────────────

/** Alias exposed for the auto-tool-generator; semantically identical to SkillCandidate. */
export type PatternCandidate = SkillCandidate;

export interface SkillCandidate {
  id: string;
  kind: 'tool-sequence' | 'failure-mode' | 'user-correction';
  signature: string;
  occurrences: number;
  exampleInputs: string[];
  exampleSessionIds: string[];
  toolSequence?: string[];
  failureSignature?: { tool: string; errorMessagePattern: string };
  averageLatencyMs?: number;
  successRate?: number;
  detectedAt: string;
  weight: number;
}

export interface MinerOptions {
  minOccurrences: number;
  minSequenceLength: number;
  maxSequenceLength: number;
  failureThreshold: number;
  windowDays?: number;
}

export interface MinerInput {
  trajectories: TrajectoryRecord[];
  options?: Partial<MinerOptions>;
}

export interface MinerResult {
  candidates: SkillCandidate[];
  scannedTrajectories: number;
  uniqueSequencesFound: number;
  uniqueFailuresFound: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + crypto.randomBytes(10).toString('hex');
}

const DEFAULT_OPTIONS: MinerOptions = {
  minOccurrences: 5,
  minSequenceLength: 3,
  maxSequenceLength: 6,
  failureThreshold: 3,
  windowDays: 30,
};

const USER_CORRECTION_RE =
  /(нет|не так|неправильно|не правильно|переделай|wrong|no.{0,5}wrong|that'?s not|fix this|change it)/i;

function normaliseErrorMessage(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function addExample(
  inputs: string[],
  sessionIds: string[],
  input: string,
  sessionId: string,
): void {
  if (sessionIds.includes(sessionId)) return;
  if (sessionIds.length >= 5) return;
  inputs.push(input);
  sessionIds.push(sessionId);
}

// ── Tool-sequence detection ────────────────────────────────────────────────

interface SequenceBucket {
  signature: string;
  toolSequence: string[];
  count: number;
  successCount: number;
  totalLatencyMs: number;
  latencyCount: number;
  exampleInputs: string[];
  exampleSessionIds: string[];
}

function mineToolSequences(
  trajectories: TrajectoryRecord[],
  opts: MinerOptions,
): { candidates: SkillCandidate[]; uniqueSequencesFound: number } {
  const buckets = new Map<string, SequenceBucket>();
  const detectedAt = new Date().toISOString();

  for (const traj of trajectories) {
    if (traj.toolCalls.length === 0) continue;
    const names = traj.toolCalls.map((t) => t.name);

    for (let L = opts.minSequenceLength; L <= opts.maxSequenceLength; L++) {
      if (L > names.length) break;
      for (let i = 0; i <= names.length - L; i++) {
        const slice = names.slice(i, i + L);
        const sig = slice.join(' -> ');

        let bucket = buckets.get(sig);
        if (!bucket) {
          bucket = {
            signature: sig,
            toolSequence: slice,
            count: 0,
            successCount: 0,
            totalLatencyMs: 0,
            latencyCount: 0,
            exampleInputs: [],
            exampleSessionIds: [],
          };
          buckets.set(sig, bucket);
        }

        bucket.count++;
        if (traj.success) bucket.successCount++;

        for (let k = i; k < i + L; k++) {
          bucket.totalLatencyMs += traj.toolCalls[k].latencyMs;
          bucket.latencyCount++;
        }

        addExample(
          bucket.exampleInputs,
          bucket.exampleSessionIds,
          traj.userInput,
          traj.sessionId,
        );
      }
    }
  }

  const uniqueSequencesFound = buckets.size;
  const candidates: SkillCandidate[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.count < opts.minOccurrences) continue;

    const successRate = bucket.count > 0 ? bucket.successCount / bucket.count : 0;
    const avgLatency =
      bucket.latencyCount > 0 ? bucket.totalLatencyMs / bucket.latencyCount : 0;
    const weight =
      Math.min(1, Math.log10(bucket.count) / 2) * (0.5 + 0.5 * successRate);

    candidates.push({
      id: generateId(),
      kind: 'tool-sequence',
      signature: bucket.signature,
      occurrences: bucket.count,
      exampleInputs: bucket.exampleInputs,
      exampleSessionIds: bucket.exampleSessionIds,
      toolSequence: bucket.toolSequence,
      averageLatencyMs: avgLatency,
      successRate,
      detectedAt,
      weight,
    });
  }

  return { candidates, uniqueSequencesFound };
}

// ── Failure-mode detection ─────────────────────────────────────────────────

interface FailureBucket {
  tool: string;
  errorMessagePattern: string;
  count: number;
  exampleInputs: string[];
  exampleSessionIds: string[];
}

function mineFailureModes(
  trajectories: TrajectoryRecord[],
  opts: MinerOptions,
): { candidates: SkillCandidate[]; uniqueFailuresFound: number } {
  const buckets = new Map<string, FailureBucket>();
  const detectedAt = new Date().toISOString();

  for (const traj of trajectories) {
    for (const call of traj.toolCalls) {
      if (call.success) continue;
      const raw = call.errorMessage ?? '';
      const pattern = normaliseErrorMessage(raw);
      const key = `${call.name}::${pattern}`;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          tool: call.name,
          errorMessagePattern: pattern,
          count: 0,
          exampleInputs: [],
          exampleSessionIds: [],
        };
        buckets.set(key, bucket);
      }

      bucket.count++;
      addExample(bucket.exampleInputs, bucket.exampleSessionIds, traj.userInput, traj.sessionId);
    }
  }

  const uniqueFailuresFound = buckets.size;
  const candidates: SkillCandidate[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.count < opts.failureThreshold) continue;

    const weight = Math.min(1, bucket.count / (opts.failureThreshold * 3));
    const sig = `${bucket.tool}: ${bucket.errorMessagePattern}`;

    candidates.push({
      id: generateId(),
      kind: 'failure-mode',
      signature: sig,
      occurrences: bucket.count,
      exampleInputs: bucket.exampleInputs,
      exampleSessionIds: bucket.exampleSessionIds,
      failureSignature: { tool: bucket.tool, errorMessagePattern: bucket.errorMessagePattern },
      detectedAt,
      weight,
    });
  }

  return { candidates, uniqueFailuresFound };
}

// ── User-correction detection ──────────────────────────────────────────────

function mineUserCorrections(trajectories: TrajectoryRecord[]): SkillCandidate[] {
  const detectedAt = new Date().toISOString();

  // Group by sessionId, sorted by startedAt within each session
  const bySession = new Map<string, TrajectoryRecord[]>();
  for (const traj of trajectories) {
    let arr = bySession.get(traj.sessionId);
    if (!arr) {
      arr = [];
      bySession.set(traj.sessionId, arr);
    }
    arr.push(traj);
  }

  const candidates: SkillCandidate[] = [];

  for (const [sessionId, trajs] of bySession) {
    // Sort by startedAt ascending
    const sorted = [...trajs].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );

    // Collect corrections: match correction regex AND have a predecessor within 5 min
    const corrections: TrajectoryRecord[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const traj = sorted[i];
      if (!USER_CORRECTION_RE.test(traj.userInput)) continue;

      const prev = sorted[i - 1];
      const diffMs =
        new Date(traj.startedAt).getTime() - new Date(prev.startedAt).getTime();
      if (diffMs <= 5 * 60 * 1000) {
        corrections.push(traj);
      }
    }

    if (corrections.length < 2) continue;

    const sig = corrections[0].userInput.slice(0, 80);
    const weight = Math.min(1, corrections.length / 5);

    candidates.push({
      id: generateId(),
      kind: 'user-correction',
      signature: sig,
      occurrences: corrections.length,
      exampleInputs: corrections.slice(0, 5).map((t) => t.userInput),
      exampleSessionIds: [sessionId],
      detectedAt,
      weight,
    });
  }

  return candidates;
}

// ── Window filtering ───────────────────────────────────────────────────────

function filterByWindow(
  trajectories: TrajectoryRecord[],
  windowDays?: number,
): TrajectoryRecord[] {
  if (!windowDays) return trajectories;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  return trajectories.filter((t) => {
    const ts = t.completedAt ?? t.startedAt;
    return new Date(ts) >= cutoff;
  });
}

// ── Pure mineTrajectories ──────────────────────────────────────────────────

export function mineTrajectories(input: MinerInput): MinerResult {
  const opts: MinerOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const scannedTrajectories = input.trajectories.length;

  if (scannedTrajectories === 0) {
    return { candidates: [], scannedTrajectories: 0, uniqueSequencesFound: 0, uniqueFailuresFound: 0 };
  }

  const windowed = filterByWindow(input.trajectories, opts.windowDays);

  const { candidates: seqCandidates, uniqueSequencesFound } = mineToolSequences(windowed, opts);
  const { candidates: failCandidates, uniqueFailuresFound } = mineFailureModes(windowed, opts);
  const corrCandidates = mineUserCorrections(windowed);

  const all = [...seqCandidates, ...failCandidates, ...corrCandidates];

  // Sort: weight desc, then occurrences desc
  all.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.occurrences - a.occurrences;
  });

  return { candidates: all, scannedTrajectories, uniqueSequencesFound, uniqueFailuresFound };
}

// ── PatternMiner class ─────────────────────────────────────────────────────

export class PatternMiner {
  private readonly opts: MinerOptions;

  constructor(opts?: Partial<MinerOptions>) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  async run(
    query: (filter: { since?: Date; until?: Date }) => Promise<TrajectoryRecord[]>,
  ): Promise<MinerResult> {
    const filter: { since?: Date; until?: Date } = {};
    if (this.opts.windowDays !== undefined) {
      const since = new Date();
      since.setDate(since.getDate() - this.opts.windowDays);
      filter.since = since;
    }

    const trajectories = await query(filter);
    return mineTrajectories({ trajectories, options: this.opts });
  }
}
