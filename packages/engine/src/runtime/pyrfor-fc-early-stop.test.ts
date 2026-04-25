// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ScoreThresholdStop, CompositeStop } from './pyrfor-fc-early-stop.js';
import type { EarlyStopPredicate } from './pyrfor-fc-early-stop.js';
import type { IterationResult } from './pyrfor-fc-ralph.js';
import type { FCEnvelope } from './pyrfor-fc-adapter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: [],
    commandsRun: [],
    raw: {},
  };
}

function makeIterResult(score: number): IterationResult {
  return {
    iter: 1,
    envelope: makeEnvelope(),
    score: { total: score, breakdown: {} },
    durationMs: 1000,
    filesTouched: [],
    costUsd: 0.05,
  };
}

function makeState(score: number, historyScores: number[] = []) {
  return {
    history: historyScores.map(makeIterResult),
    current: makeIterResult(score),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScoreThresholdStop', () => {
  it('returns stop=true when score >= threshold', () => {
    const stop = new ScoreThresholdStop(80);
    const result = stop.shouldStop(makeState(80));
    expect(result.stop).toBe(true);
    expect(result.reason).toContain('80');
  });

  it('returns stop=true when score exceeds threshold', () => {
    const stop = new ScoreThresholdStop(80);
    expect(stop.shouldStop(makeState(95)).stop).toBe(true);
  });

  it('returns stop=false when score is below threshold', () => {
    const stop = new ScoreThresholdStop(80);
    expect(stop.shouldStop(makeState(79)).stop).toBe(false);
  });

  it('returns stop=false when score is 0', () => {
    const stop = new ScoreThresholdStop(80);
    expect(stop.shouldStop(makeState(0)).stop).toBe(false);
  });

  it('threshold=0 always stops (every score >= 0)', () => {
    const stop = new ScoreThresholdStop(0);
    expect(stop.shouldStop(makeState(0)).stop).toBe(true);
  });
});

describe('CompositeStop', () => {
  it('returns stop=false when no predicates trigger', () => {
    const p1: EarlyStopPredicate = { shouldStop: vi.fn().mockReturnValue({ stop: false }) };
    const p2: EarlyStopPredicate = { shouldStop: vi.fn().mockReturnValue({ stop: false }) };
    const composite = new CompositeStop([p1, p2]);
    expect(composite.shouldStop(makeState(50)).stop).toBe(false);
  });

  it('returns stop=true when first predicate triggers (OR semantics)', () => {
    const p1: EarlyStopPredicate = {
      shouldStop: vi.fn().mockReturnValue({ stop: true, reason: 'p1-hit' }),
    };
    const p2: EarlyStopPredicate = { shouldStop: vi.fn().mockReturnValue({ stop: false }) };
    const composite = new CompositeStop([p1, p2]);
    const result = composite.shouldStop(makeState(50));
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('p1-hit');
  });

  it('returns stop=true when second predicate triggers', () => {
    const p1: EarlyStopPredicate = { shouldStop: vi.fn().mockReturnValue({ stop: false }) };
    const p2: EarlyStopPredicate = {
      shouldStop: vi.fn().mockReturnValue({ stop: true, reason: 'p2-hit' }),
    };
    const composite = new CompositeStop([p1, p2]);
    const result = composite.shouldStop(makeState(50));
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('p2-hit');
  });

  it('can combine ScoreThresholdStop with a custom predicate', () => {
    const thresholdStop = new ScoreThresholdStop(90);
    const customStop: EarlyStopPredicate = {
      shouldStop: ({ current }) =>
        current.score.total < 20
          ? { stop: true, reason: 'too-low' }
          : { stop: false },
    };
    const composite = new CompositeStop([thresholdStop, customStop]);

    expect(composite.shouldStop(makeState(95)).stop).toBe(true); // threshold hit
    expect(composite.shouldStop(makeState(10)).stop).toBe(true);  // custom hit
    expect(composite.shouldStop(makeState(50)).stop).toBe(false); // neither
  });

  it('empty composite never stops', () => {
    const composite = new CompositeStop([]);
    expect(composite.shouldStop(makeState(100)).stop).toBe(false);
  });
});
