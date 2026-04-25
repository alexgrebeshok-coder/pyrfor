// @vitest-environment node
import type { IterationResult } from './pyrfor-fc-ralph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StruggleDetectorOptions {
  plateauWindow?: number;
  plateauDelta?: number;
  sameErrorN?: number;
  costSpikeMultiplier?: number;
}

export interface StruggleDetector {
  detect(history: IterationResult[]): { stuck: boolean; reason?: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class DefaultStruggleDetector implements StruggleDetector {
  private readonly plateauWindow: number;
  private readonly plateauDelta: number;
  private readonly sameErrorN: number;
  private readonly costSpikeMultiplier: number;

  constructor(opts?: StruggleDetectorOptions) {
    this.plateauWindow = opts?.plateauWindow ?? 3;
    this.plateauDelta = opts?.plateauDelta ?? 2;
    this.sameErrorN = opts?.sameErrorN ?? 3;
    this.costSpikeMultiplier = opts?.costSpikeMultiplier ?? 3;
  }

  detect(history: IterationResult[]): { stuck: boolean; reason?: string } {
    if (history.length === 0) return { stuck: false };

    // ── Plateau: last plateauWindow iters all within plateauDelta AND below 80 ──
    if (history.length >= this.plateauWindow) {
      const window = history.slice(-this.plateauWindow);
      const scores = window.map((r) => r.score.total);
      const minS = Math.min(...scores);
      const maxS = Math.max(...scores);
      if (maxS - minS <= this.plateauDelta && maxS < 80) {
        return { stuck: true, reason: 'plateau' };
      }
    }

    // ── Same error: same breakdown.failedCheck repeated sameErrorN times ──
    if (history.length >= this.sameErrorN) {
      const recent = history.slice(-this.sameErrorN);
      const errors = recent.map((r) => {
        const bd = r.score.breakdown as Record<string, unknown> | null | undefined;
        return bd?.failedCheck;
      });
      if (
        errors[0] !== undefined &&
        errors[0] !== null &&
        errors.every((e) => e === errors[0])
      ) {
        return { stuck: true, reason: `same-error:${errors[0]}` };
      }
    }

    // ── Cost spike: latest > costSpikeMultiplier × median(prior) ──
    if (history.length >= 2) {
      const prior = history.slice(0, -1).map((r) => r.costUsd);
      const latest = history[history.length - 1]!.costUsd;
      const med = median(prior);
      if (med > 0 && latest > this.costSpikeMultiplier * med) {
        return { stuck: true, reason: 'cost-spike' };
      }
    }

    return { stuck: false };
  }
}
