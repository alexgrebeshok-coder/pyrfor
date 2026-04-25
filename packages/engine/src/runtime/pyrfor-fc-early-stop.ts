// @vitest-environment node
import type { IterationResult } from './pyrfor-fc-ralph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EarlyStopPredicate {
  shouldStop(state: {
    history: IterationResult[];
    current: IterationResult;
  }): { stop: boolean; reason?: string };
}

// ─── ScoreThresholdStop ───────────────────────────────────────────────────────

export class ScoreThresholdStop implements EarlyStopPredicate {
  constructor(private readonly threshold: number) {}

  shouldStop(state: {
    history: IterationResult[];
    current: IterationResult;
  }): { stop: boolean; reason?: string } {
    if (state.current.score.total >= this.threshold) {
      return {
        stop: true,
        reason: `score ${state.current.score.total} >= threshold ${this.threshold}`,
      };
    }
    return { stop: false };
  }
}

// ─── CompositeStop (OR semantics) ─────────────────────────────────────────────

export class CompositeStop implements EarlyStopPredicate {
  constructor(private readonly predicates: EarlyStopPredicate[]) {}

  shouldStop(state: {
    history: IterationResult[];
    current: IterationResult;
  }): { stop: boolean; reason?: string } {
    for (const p of this.predicates) {
      const result = p.shouldStop(state);
      if (result.stop) return result;
    }
    return { stop: false };
  }
}
