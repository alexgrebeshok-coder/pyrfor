// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createContextRotator,
  defaultSummariser,
} from './ralph-context-rotator.js';

describe('ralph-context-rotator', () => {
  it('under budget → rotate false', () => {
    const r = createContextRotator({ maxTokens: 1000 });
    const ctx = 'hello world'; // ~3 tokens
    const dec = r.shouldRotate(ctx);
    expect(dec.rotate).toBe(false);
    expect(dec.tokensEstimated).toBeLessThanOrEqual(10);
  });

  it('over budget → rotate true', () => {
    const r = createContextRotator({ maxTokens: 5 });
    const ctx = 'this is a fairly long string that should exceed budget';
    const dec = r.shouldRotate(ctx);
    expect(dec.rotate).toBe(true);
    expect(dec.reason).toContain('exceeds');
  });

  it('empty context → no rotate', () => {
    const r = createContextRotator({ maxTokens: 100 });
    const dec = r.shouldRotate('');
    expect(dec.rotate).toBe(false);
  });

  it('custom estimator is used', () => {
    const r = createContextRotator({
      maxTokens: 10,
      estimateTokens: (t) => t.length * 2, // aggressive estimate
    });
    const ctx = 'hello'; // 5*2=10 exactly — not over
    const dec = r.shouldRotate(ctx);
    expect(dec.tokensEstimated).toBe(10);
    expect(dec.rotate).toBe(false);

    const dec2 = r.shouldRotate('hello!'); // 12 > 10
    expect(dec2.rotate).toBe(true);
  });

  it('estimate method uses same estimator', () => {
    const r = createContextRotator({ estimateTokens: (t) => t.length });
    expect(r.estimate('abcde')).toBe(5);
  });

  it('defaultSummariser keeps last lines within budget', () => {
    // Use 13-char lines so total (69) > maxTokens (40)
    const lines = ['verylongline1', 'verylongline2', 'verylongline3', 'verylongline4', 'verylongline5'];
    const text = lines.join('\n');
    const estimate = (s: string) => s.length;
    // marker (25) + 'verylongline5\n' (14) = 39 ≤ 40; next line would exceed budget
    const result = defaultSummariser(text, { maxTokens: 40, estimate });
    expect(result).toContain('── earlier truncated ──');
    expect(result).toContain('verylongline5');
    expect(result).not.toContain('verylongline1');
  });

  it('defaultSummariser truncates to maxTokens', () => {
    const text = 'a\n'.repeat(100);
    const estimate = (s: string) => s.length;
    const maxTokens = 50;
    expect(estimate(text)).toBeGreaterThan(maxTokens);
    const result = defaultSummariser(text, { maxTokens, estimate });
    expect(estimate(result)).toBeLessThanOrEqual(maxTokens);
  });

  it('async summariseFn is awaited', async () => {
    const r = createContextRotator({
      maxTokens: 5,
      summaryMaxTokens: 1000,
      summariseFn: async (text) => `SUMMARY: ${text.slice(0, 5)}`,
    });
    const { summary } = await r.rotate('hello world long context');
    expect(summary).toContain('SUMMARY:');
  });

  it('sync summariseFn is supported', async () => {
    const r = createContextRotator({
      maxTokens: 5,
      summaryMaxTokens: 1000,
      summariseFn: (text) => `SYNC: ${text.slice(0, 5)}`,
    });
    const { summary } = await r.rotate('some context here');
    expect(summary).toContain('SYNC:');
  });

  it('summary capped to summaryMaxTokens', async () => {
    const r = createContextRotator({
      maxTokens: 5,
      summaryMaxTokens: 10,
      estimateTokens: (t) => t.length,
      summariseFn: () => 'this is a very long summary that exceeds the cap entirely',
    });
    const { summary } = await r.rotate('context');
    expect(summary.length).toBeLessThanOrEqual(10 * 4 + 10); // some tolerance for truncation
    // The important thing: estimate(summary) <= summaryMaxTokens
    expect(summary.length).toBeLessThanOrEqual(10);
  });

  it('deterministic output for same input', async () => {
    const r = createContextRotator({ maxTokens: 5, summaryMaxTokens: 20 });
    const ctx = 'line1\nline2\nline3\nline4\nline5';
    const r1 = await r.rotate(ctx);
    const r2 = await r.rotate(ctx);
    expect(r1.summary).toBe(r2.summary);
  });
});
