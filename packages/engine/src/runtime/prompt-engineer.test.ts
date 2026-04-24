// @vitest-environment node

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { createPromptEngineer } from './prompt-engineer.js';
import type { CreateExperimentInput } from './prompt-engineer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _counter = 0;

/** Create a unique file path in os.tmpdir() for each test. */
function tmpFile(): string {
  const dir = path.join(
    os.tmpdir(),
    `pyrfor-pe-test-${Date.now()}-${++_counter}`,
  );
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'experiments.json');
}

function twoVariants(): CreateExperimentInput['variants'] {
  return [
    { label: 'control', prompt: 'You are a helpful assistant.' },
    { label: 'variant-A', prompt: 'You are an expert assistant.' },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PromptEngineer', () => {
  // ── createExperiment ──────────────────────────────────────────────────────

  it('createExperiment applies defaults (status=draft, minSamples=10, criterion=success_rate, sig=0.05)', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'global',
      hypothesis: 'variant-A improves quality',
      variants: twoVariants(),
    });

    expect(exp.status).toBe('draft');
    expect(exp.minSamplesPerVariant).toBe(10);
    expect(exp.successCriterion).toBe('success_rate');
    expect(exp.significanceDelta).toBe(0.05);
    expect(exp.variants).toHaveLength(2);
    expect(exp.variants[0].weight).toBe(1);
    expect(exp.variants[1].weight).toBe(1);
    expect(exp.id).toBeTruthy();
    expect(exp.createdAt).toBeTruthy();
    // Each variant gets its own id and empty metrics bucket.
    for (const v of exp.variants) {
      expect(exp.metrics[v.id].sessions).toBe(0);
    }
  });

  // ── start ─────────────────────────────────────────────────────────────────

  it('start transitions draft→running', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    const started = pe.start(exp.id);
    expect(started?.status).toBe('running');
    expect(pe.get(exp.id)?.status).toBe('running');
  });

  it('start returns null for non-draft experiment', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(exp.id); // → running
    expect(pe.start(exp.id)).toBeNull(); // already running
  });

  // ── archive ───────────────────────────────────────────────────────────────

  it('archive transitions to archived regardless of current status', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(exp.id);
    const result = pe.archive(exp.id);
    expect(result?.status).toBe('archived');
    expect(pe.get(exp.id)?.status).toBe('archived');
  });

  // ── pickVariant ───────────────────────────────────────────────────────────

  it('pickVariant returns null when no running experiment exists', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() }); // draft only
    expect(pe.pickVariant({ project: 'p' })).toBeNull();
  });

  it('pickVariant returns a variant when running; deterministic with seeded rng', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(), // both weight=1
    });
    pe.start(exp.id);

    // rng()=0 → r = 0 * 2 = 0 < 1 (cumulative of first variant) → picks first (control)
    const result = pe.pickVariant({ project: 'p', rng: () => 0 });
    expect(result).not.toBeNull();
    expect(result?.experimentId).toBe(exp.id);
    expect(result?.variantId).toBe(exp.variants[0].id);
    expect(result?.prompt).toBe('You are a helpful assistant.');

    // rng()=0.9 → r = 0.9 * 2 = 1.8 ≥ 1 → picks second (variant-A)
    const result2 = pe.pickVariant({ project: 'p', rng: () => 0.9 });
    expect(result2?.variantId).toBe(exp.variants[1].id);
  });

  it('pickVariant filters by project', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const e1 = pe.createExperiment({ project: 'alpha', hypothesis: 'h', variants: twoVariants() });
    const e2 = pe.createExperiment({ project: 'beta', hypothesis: 'h', variants: twoVariants() });
    pe.start(e1.id);
    pe.start(e2.id);

    expect(pe.pickVariant({ project: 'alpha' })?.experimentId).toBe(e1.id);
    expect(pe.pickVariant({ project: 'beta' })?.experimentId).toBe(e2.id);
    expect(pe.pickVariant({ project: 'gamma' })).toBeNull();
  });

  it('pickVariant filters by agent — scoped experiment requires matching agent', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'alpha',
      agent: 'bot-1',
      hypothesis: 'h',
      variants: twoVariants(),
    });
    pe.start(exp.id);

    // Different agent → null.
    expect(pe.pickVariant({ project: 'alpha', agent: 'bot-2' })).toBeNull();
    // No agent → null (experiment is agent-scoped; caller lacks context).
    expect(pe.pickVariant({ project: 'alpha' })).toBeNull();
    // Correct agent → variant returned.
    expect(pe.pickVariant({ project: 'alpha', agent: 'bot-1' })).not.toBeNull();
  });

  it('pickVariant respects weights — boundary sampling', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: [
        { label: 'control', prompt: 'c', weight: 1 },
        { label: 'variant-A', prompt: 'a', weight: 3 },
      ],
    });
    pe.start(exp.id);

    // totalWeight = 4.
    // rng = 0.99/4 = 0.2475 → r = 0.99 < 1 (cumulative of control) → control
    const ctrl = pe.pickVariant({ project: 'p', rng: () => 0.99 / 4 });
    expect(ctrl?.variantId).toBe(exp.variants[0].id);

    // rng = 1.01/4 = 0.2525 → r = 1.01 ≥ 1 → variant-A
    const va = pe.pickVariant({ project: 'p', rng: () => 1.01 / 4 });
    expect(va?.variantId).toBe(exp.variants[1].id);
  });

  it('pickVariant skips weight=0 variants', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: [
        { label: 'control', prompt: 'c', weight: 0 },
        { label: 'variant-A', prompt: 'a', weight: 1 },
      ],
    });
    pe.start(exp.id);

    // Even with rng=0 (which would normally pick the first), weight=0 is excluded.
    const result = pe.pickVariant({ project: 'p', rng: () => 0 });
    expect(result?.variantId).toBe(exp.variants[1].id);
  });

  it('pickVariant falls back to uniform distribution when all weights are 0', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: [
        { label: 'control', prompt: 'c', weight: 0 },
        { label: 'variant-A', prompt: 'a', weight: 0 },
      ],
    });
    pe.start(exp.id);

    // Uniform fallback: both treated as weight=1, totalWeight=2.
    // rng=0 → r=0 < 1 → first variant.
    expect(pe.pickVariant({ project: 'p', rng: () => 0 })?.variantId).toBe(exp.variants[0].id);
    // rng=0.99 → r=1.98 ≥ 1 → second variant.
    expect(pe.pickVariant({ project: 'p', rng: () => 0.99 })?.variantId).toBe(exp.variants[1].id);
  });

  // ── recordOutcome ─────────────────────────────────────────────────────────

  it('recordOutcome increments metrics correctly', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 100, // prevent auto-evaluate
    });
    pe.start(exp.id);

    const vid = exp.variants[0].id;
    pe.recordOutcome(exp.id, vid, { success: true, latencyMs: 200, tokensIn: 10, tokensOut: 20, costUsd: 0.001 });
    pe.recordOutcome(exp.id, vid, { success: false, latencyMs: 300, tokensIn: 5, tokensOut: 15, costUsd: 0.002 });

    const m = pe.get(exp.id)!.metrics[vid];
    expect(m.sessions).toBe(2);
    expect(m.successes).toBe(1);
    expect(m.failures).toBe(1);
    expect(m.totalLatencyMs).toBe(500);
    expect(m.totalTokensIn).toBe(15);
    expect(m.totalTokensOut).toBe(35);
    expect(m.totalCostUsd).toBeCloseTo(0.003);
  });

  it('recordOutcome on archived experiment is a no-op', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(exp.id);
    pe.archive(exp.id);

    const result = pe.recordOutcome(exp.id, exp.variants[0].id, { success: true, latencyMs: 100 });
    expect(result?.status).toBe('archived');
    // Metrics must remain untouched.
    expect(result?.metrics[exp.variants[0].id].sessions).toBe(0);
  });

  // ── evaluate ──────────────────────────────────────────────────────────────

  it('evaluate success_rate decides winner when delta is met', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 2,
      significanceDelta: 0.05,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl: 0/2 = 0 %, va: 2/2 = 100 %; delta = 1.0 ≥ 0.05
    pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 100 });
    pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 }); // auto-evaluate fires

    const result = pe.evaluate(exp.id); // explicit re-evaluation confirms
    expect(result.decided).toBe(true);
    expect(result.winner).toBe(va.id);
    expect(result.status).not.toBe('inconclusive');
  });

  it('evaluate success_rate is inconclusive when delta is below threshold', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 10,
      significanceDelta: 0.5, // very high bar
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl: 5/10 = 50 %, va: 6/10 = 60 %; delta = 0.10 < 0.5 → inconclusive
    for (let i = 0; i < 5; i++) {
      pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100 });
      pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 100 });
    }
    // va: 8 sessions (4 success) so far — not all at threshold yet
    for (let i = 0; i < 4; i++) {
      pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
      pe.recordOutcome(exp.id, va.id, { success: false, latencyMs: 100 });
    }
    expect(pe.get(exp.id)?.status).toBe('running'); // va at 8, not yet 10
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 }); // va=9
    expect(pe.get(exp.id)?.status).toBe('running');
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 }); // va=10 → triggers auto-evaluate

    expect(pe.get(exp.id)?.status).toBe('inconclusive');
    const result = pe.evaluate(exp.id);
    expect(result.decided).toBe(false);
    expect(result.status).toBe('inconclusive');
  });

  it('evaluate latency picks the lowest average latency variant', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 2,
      successCriterion: 'latency',
      significanceDelta: 0.1,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl avg = 500 ms, va avg = 100 ms; relImprovement = (500-100)/500 = 0.8 ≥ 0.1
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 500 });
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 500 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });

    const result = pe.evaluate(exp.id);
    expect(result.decided).toBe(true);
    expect(result.winner).toBe(va.id);
    expect(result.status).toBe('won'); // va beat control
  });

  it('evaluate cost picks the lowest average cost variant', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 2,
      successCriterion: 'cost',
      significanceDelta: 0.1,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl avg = $0.01, va avg = $0.001; relImprovement = (0.01-0.001)/0.01 = 0.9 ≥ 0.1
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100, costUsd: 0.01 });
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100, costUsd: 0.01 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100, costUsd: 0.001 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100, costUsd: 0.001 });

    const result = pe.evaluate(exp.id);
    expect(result.decided).toBe(true);
    expect(result.winner).toBe(va.id);
    expect(result.status).toBe('won');
  });

  it('evaluate composite: 0.6·sr − 0.2·latNorm − 0.2·costNorm', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 2,
      successCriterion: 'composite',
      significanceDelta: 0.05,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl: sr=0.5, latNorm=1 (worst latency), costNorm=1 (worst cost)
    //       score = 0.6·0.5 − 0.2·1 − 0.2·1 = 0.3 − 0.4 = −0.1
    // va  : sr=1.0, latNorm=0 (best latency), costNorm=0 (best cost)
    //       score = 0.6·1 − 0 − 0 = 0.6
    // delta = 0.7 ≥ 0.05 → va wins
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 1000, costUsd: 0.01 });
    pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 1000, costUsd: 0.01 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100, costUsd: 0.001 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100, costUsd: 0.001 });

    const result = pe.evaluate(exp.id);
    expect(result.decided).toBe(true);
    expect(result.winner).toBe(va.id);
    expect(result.status).toBe('won');
  });

  it('auto-evaluate triggers exactly when all variants reach minSamplesPerVariant', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 2,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // ctrl hits 2 samples but va is still at 0 → should NOT evaluate yet.
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100 });
    expect(pe.get(exp.id)?.status).toBe('running');

    // va at 1 — still not all satisfied.
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
    expect(pe.get(exp.id)?.status).toBe('running');

    // va at 2 — all satisfied → auto-evaluate fires → status changes.
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
    expect(pe.get(exp.id)?.status).not.toBe('running');
  });

  it('status is won when a non-control variant beats control', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: [
        { label: 'control', prompt: 'c' },
        { label: 'variant-A', prompt: 'a' },
      ],
      minSamplesPerVariant: 2,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // control: 0 % success, variant-A: 100 % success
    pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 100 });
    pe.recordOutcome(exp.id, ctrl.id, { success: false, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: true, latencyMs: 100 });

    const finalExp = pe.get(exp.id)!;
    expect(finalExp.status).toBe('won');
    expect(finalExp.winner).toBe(va.id);
    expect(finalExp.decidedAt).toBeTruthy();
  });

  it('status is lost when control variant wins', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const exp = pe.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: [
        { label: 'control', prompt: 'c' },
        { label: 'variant-A', prompt: 'a' },
      ],
      minSamplesPerVariant: 2,
    });
    pe.start(exp.id);
    const [ctrl, va] = exp.variants;

    // control: 100 % success, variant-A: 0 % success
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, ctrl.id, { success: true, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: false, latencyMs: 100 });
    pe.recordOutcome(exp.id, va.id, { success: false, latencyMs: 100 });

    const finalExp = pe.get(exp.id)!;
    expect(finalExp.status).toBe('lost');
    expect(finalExp.winner).toBe(ctrl.id);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it('list filters by project', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const e1 = pe.createExperiment({ project: 'alpha', hypothesis: 'h', variants: twoVariants() });
    const e2 = pe.createExperiment({ project: 'beta', hypothesis: 'h', variants: twoVariants() });
    pe.start(e1.id);
    pe.start(e2.id);

    const alphaList = pe.list({ project: 'alpha' });
    const ids = alphaList.map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
  });

  it('list filters by a status array', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const e1 = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() }); // draft
    const e2 = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(e2.id); // running
    const e3 = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(e3.id);
    pe.archive(e3.id); // archived

    const results = pe.list({ status: ['draft', 'running'] });
    const ids = results.map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
    expect(ids).not.toContain(e3.id);
  });

  it('list excludes archived experiments by default (no status filter)', () => {
    const pe = createPromptEngineer({ filePath: tmpFile() });
    const e1 = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() }); // draft
    const e2 = pe.createExperiment({ project: 'p', hypothesis: 'h', variants: twoVariants() });
    pe.start(e2.id);
    pe.archive(e2.id); // archived

    const all = pe.list();
    const ids = all.map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
  });

  // ── persistence ───────────────────────────────────────────────────────────

  it('save + load round-trip preserves experiments and metrics', () => {
    const fp = tmpFile();
    const pe1 = createPromptEngineer({ filePath: fp });
    const exp = pe1.createExperiment({
      project: 'p',
      hypothesis: 'h',
      variants: twoVariants(),
      minSamplesPerVariant: 100,
    });
    pe1.start(exp.id);
    pe1.recordOutcome(exp.id, exp.variants[0].id, {
      success: true,
      latencyMs: 123,
      tokensIn: 7,
      tokensOut: 14,
      costUsd: 0.005,
    });
    pe1.save();

    const pe2 = createPromptEngineer({ filePath: fp });
    pe2.load();

    const loaded = pe2.get(exp.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.project).toBe('p');
    expect(loaded?.status).toBe('running');
    expect(loaded?.metrics[exp.variants[0].id].sessions).toBe(1);
    expect(loaded?.metrics[exp.variants[0].id].totalLatencyMs).toBe(123);
    expect(loaded?.metrics[exp.variants[0].id].tokensIn).toBeUndefined(); // field is not in ExperimentMetrics
    expect(loaded?.metrics[exp.variants[0].id].totalTokensIn).toBe(7);
  });

  it('load with corrupt JSON does not throw and starts with empty store', () => {
    const fp = tmpFile();
    writeFileSync(fp, '{ not valid json !!!', 'utf8');

    const pe = createPromptEngineer({ filePath: fp });
    expect(() => pe.load()).not.toThrow();
    expect(pe.list()).toHaveLength(0);
  });
});
