// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStruggleDetector,
  detectStruggle,
} from './ralph-struggle-detector.js';

describe('ralph-struggle-detector', () => {
  describe('createStruggleDetector', () => {
    it('single observation returns progressing', () => {
      const d = createStruggleDetector();
      const sig = d.observe(50);
      expect(sig.kind).toBe('progressing');
    });

    it('progressing path — score clearly improving', () => {
      const d = createStruggleDetector({ minIterations: 2 });
      d.observe(10);
      const sig = d.observe(20);
      expect(sig.kind).toBe('progressing');
      expect((sig as { kind: 'progressing'; lastScore: number }).lastScore).toBe(20);
    });

    it('flat path — three same-ish scores', () => {
      const d = createStruggleDetector({ flatWindow: 3, flatTolerance: 1.0, minIterations: 3 });
      d.observe(50);
      d.observe(50.5);
      const sig = d.observe(50.2);
      expect(sig.kind).toBe('flat');
      if (sig.kind === 'flat') {
        expect(sig.iterations).toBe(3);
        expect(sig.lastScore).toBeCloseTo(50.2);
      }
    });

    it('regression path — drop > 5', () => {
      const d = createStruggleDetector({ regressionTolerance: 5, minIterations: 2 });
      d.observe(80);
      const sig = d.observe(70);
      expect(sig.kind).toBe('regression');
      if (sig.kind === 'regression') {
        expect(sig.from).toBe(80);
        expect(sig.to).toBe(70);
      }
    });

    it('oscillation path', () => {
      // flatWindow=3 → oscWindow=6, need ≥3 flips
      // Provide 7+ scores that alternate: up, down, up, down, up, down...
      const d = createStruggleDetector({ flatWindow: 3, flatTolerance: 0.1, minIterations: 3 });
      [10, 20, 10, 20, 10, 20, 10].forEach((s) => d.observe(s));
      const sig = d.observe(20);
      expect(sig.kind).toBe('oscillation');
    });

    it('below minIterations returns progressing', () => {
      const d = createStruggleDetector({ minIterations: 5 });
      d.observe(10);
      d.observe(5); // would be regression but below minIterations
      const sig = d.observe(1);
      expect(sig.kind).toBe('progressing');
    });

    it('reset works — history cleared', () => {
      const d = createStruggleDetector();
      d.observe(10);
      d.observe(20);
      d.reset();
      expect(d.history()).toHaveLength(0);
      const sig = d.observe(50);
      expect(sig.kind).toBe('progressing');
    });

    it('history snapshot accumulates correctly', () => {
      const d = createStruggleDetector();
      d.observe(10);
      d.observe(20);
      d.observe(30);
      expect(d.history()).toEqual([10, 20, 30]);
    });

    it('regression takes priority over flat', () => {
      // Flat window satisfied, but last score also regresses heavily
      const d = createStruggleDetector({
        flatWindow: 3,
        flatTolerance: 20,
        regressionTolerance: 5,
        minIterations: 3,
      });
      d.observe(50);
      d.observe(50);
      const sig = d.observe(40); // drop of 10 > regressionTolerance 5
      expect(sig.kind).toBe('regression');
    });

    it('custom flatWindow respected', () => {
      const d = createStruggleDetector({ flatWindow: 5, flatTolerance: 1.0, minIterations: 5 });
      [50, 50, 50, 50].forEach((s) => d.observe(s));
      // Only 4 scores, flatWindow is 5 — should not be flat yet
      const sig = d.observe(50);
      expect(sig.kind).toBe('flat');
      if (sig.kind === 'flat') expect(sig.iterations).toBe(5);
    });
  });

  describe('detectStruggle (standalone)', () => {
    it('empty input returns progressing with lastScore 0', () => {
      const sig = detectStruggle([]);
      expect(sig.kind).toBe('progressing');
      if (sig.kind === 'progressing') expect(sig.lastScore).toBe(0);
    });

    it('detectStruggle detects flat on static array', () => {
      const sig = detectStruggle([50, 50, 50], { flatWindow: 3, minIterations: 3 });
      expect(sig.kind).toBe('flat');
    });

    it('detectStruggle detects regression on static array', () => {
      const sig = detectStruggle([80, 60], {
        regressionTolerance: 5,
        minIterations: 2,
      });
      expect(sig.kind).toBe('regression');
    });
  });
});
