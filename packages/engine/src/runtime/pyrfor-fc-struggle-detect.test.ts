// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DefaultStruggleDetector } from './pyrfor-fc-struggle-detect.js';
import type { IterationResult } from './pyrfor-fc-ralph.js';
import type { FCEnvelope } from './pyrfor-fc-adapter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: [],
    commandsRun: [],
    costUsd: 0.1,
    sessionId: 'sess-1',
    durationMs: 500,
    raw: {},
  };
}

function makeIterResult(
  score: number,
  costUsd = 0.1,
  failedCheck?: string
): IterationResult {
  return {
    iter: 1,
    envelope: makeEnvelope(),
    score: {
      total: score,
      breakdown: failedCheck !== undefined ? { failedCheck } : {},
    },
    durationMs: 1000,
    filesTouched: [],
    costUsd,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DefaultStruggleDetector', () => {
  it('plateau: 3 iters at score 60,61,60 → stuck with reason plateau', () => {
    const detector = new DefaultStruggleDetector();
    const history = [
      makeIterResult(60),
      makeIterResult(61),
      makeIterResult(60),
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('plateau');
  });

  it('plateau not triggered when scores span > plateauDelta', () => {
    const detector = new DefaultStruggleDetector();
    const history = [
      makeIterResult(60),
      makeIterResult(65),
      makeIterResult(60),
    ];
    const result = detector.detect(history);
    // range = 5 > 2, so plateau should NOT trigger
    expect(result.stuck).toBe(false);
  });

  it('plateau not triggered when score >= 80 (not "below 80")', () => {
    const detector = new DefaultStruggleDetector();
    // scores 80, 81, 80 — within delta but NOT below 80
    const history = [
      makeIterResult(80),
      makeIterResult(81),
      makeIterResult(80),
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(false);
  });

  it('same error: 3× failedCheck=type-check → stuck', () => {
    const detector = new DefaultStruggleDetector();
    const history = [
      makeIterResult(55, 0.1, 'type-check'),
      makeIterResult(57, 0.1, 'type-check'),
      makeIterResult(54, 0.1, 'type-check'),
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(true);
    expect(result.reason).toContain('type-check');
  });

  it('same error: different failedCheck values → not stuck', () => {
    const detector = new DefaultStruggleDetector();
    const history = [
      makeIterResult(55, 0.1, 'type-check'),
      makeIterResult(57, 0.1, 'lint-error'),
      makeIterResult(54, 0.1, 'type-check'),
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(false);
  });

  it('cost spike: median 0.10, latest 0.50 → stuck', () => {
    const detector = new DefaultStruggleDetector();
    // Use varied scores to avoid triggering plateau (range > plateauDelta=2 in last 3)
    const history = [
      makeIterResult(50, 0.10),
      makeIterResult(75, 0.10),
      makeIterResult(30, 0.10),
      makeIterResult(60, 0.50), // spike: 0.50 > 3 × median(0.10,0.10,0.10) = 0.30
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('cost-spike');
  });

  it('cost spike not triggered when latest <= multiplier * median', () => {
    const detector = new DefaultStruggleDetector();
    const history = [
      makeIterResult(50, 0.10),
      makeIterResult(75, 0.10),
      makeIterResult(30, 0.10),
      makeIterResult(60, 0.25), // 0.25 <= 3 × 0.10 = 0.30 → no spike
    ];
    const result = detector.detect(history);
    expect(result.stuck).toBe(false);
  });

  it('short history (< plateauWindow) → not stuck', () => {
    const detector = new DefaultStruggleDetector();
    const history = [makeIterResult(60), makeIterResult(61)]; // only 2, < window=3
    const result = detector.detect(history);
    expect(result.stuck).toBe(false);
  });

  it('empty history → not stuck', () => {
    const detector = new DefaultStruggleDetector();
    const result = detector.detect([]);
    expect(result.stuck).toBe(false);
  });

  it('custom options respected', () => {
    const detector = new DefaultStruggleDetector({
      plateauWindow: 2,
      plateauDelta: 0,
    });
    // Two iters with identical score → plateau with window=2, delta=0
    const history = [makeIterResult(50), makeIterResult(50)];
    const result = detector.detect(history);
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('plateau');
  });
});
