// @vitest-environment node
export interface StruggleDetectorOptions {
  flatWindow?: number;
  flatTolerance?: number;
  regressionTolerance?: number;
  minIterations?: number;
}

export type StruggleSignal =
  | { kind: 'progressing'; lastScore: number }
  | { kind: 'flat'; iterations: number; lastScore: number }
  | { kind: 'regression'; from: number; to: number }
  | { kind: 'oscillation'; window: number };

export interface StruggleDetector {
  observe(score: number): StruggleSignal;
  reset(): void;
  history(): readonly number[];
}

function resolveOpts(opts?: StruggleDetectorOptions) {
  return {
    flatWindow: opts?.flatWindow ?? 3,
    flatTolerance: opts?.flatTolerance ?? 1.0,
    regressionTolerance: opts?.regressionTolerance ?? 5.0,
    minIterations: opts?.minIterations ?? 3,
  };
}

function analyseScores(scores: number[], o: ReturnType<typeof resolveOpts>): StruggleSignal {
  const len = scores.length;
  if (len === 0) return { kind: 'progressing', lastScore: 0 };

  const last = scores[len - 1]!;

  if (len < o.minIterations) {
    return { kind: 'progressing', lastScore: last };
  }

  const prev = scores[len - 2]!;

  // Regression check
  if (last < prev - o.regressionTolerance) {
    return { kind: 'regression', from: prev, to: last };
  }

  // Oscillation check: in last flatWindow*2 scores, sign of delta flips >= flatWindow times
  const oscWindow = o.flatWindow * 2;
  if (len >= oscWindow + 1) {
    const window = scores.slice(len - oscWindow - 1);
    let flips = 0;
    let prevSign: number | null = null;
    for (let i = 1; i < window.length; i++) {
      const delta = window[i]! - window[i - 1]!;
      const sign = delta > 0 ? 1 : delta < 0 ? -1 : 0;
      if (sign !== 0 && prevSign !== null && sign !== prevSign) {
        flips++;
      }
      if (sign !== 0) prevSign = sign;
    }
    if (flips >= o.flatWindow) {
      return { kind: 'oscillation', window: oscWindow };
    }
  }

  // Flat check: last flatWindow scores within ±flatTolerance of each other
  if (len >= o.flatWindow) {
    const window = scores.slice(len - o.flatWindow);
    const min = Math.min(...window);
    const max = Math.max(...window);
    if (max - min <= o.flatTolerance) {
      return { kind: 'flat', iterations: o.flatWindow, lastScore: last };
    }
  }

  // Progressing
  return { kind: 'progressing', lastScore: last };
}

export function createStruggleDetector(opts?: StruggleDetectorOptions): StruggleDetector {
  const o = resolveOpts(opts);
  let scores: number[] = [];

  return {
    observe(score: number): StruggleSignal {
      scores.push(score);
      return analyseScores(scores, o);
    },
    reset(): void {
      scores = [];
    },
    history(): readonly number[] {
      return scores;
    },
  };
}

export function detectStruggle(scores: number[], opts?: StruggleDetectorOptions): StruggleSignal {
  return analyseScores(scores, resolveOpts(opts));
}
