// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runBestOfN } from '../pyrfor-fc-best-of-n';
import type { BestOfNOptions, BranchResult } from '../pyrfor-fc-best-of-n';
import type { FCEnvelope, FCHandle, FCRunResult, FCRunOptions } from '../pyrfor-fc-adapter';

// ── Stub helpers ──────────────────────────────────────────────────────────────

function makeEnvelope(partial: Partial<FCEnvelope> = {}): FCEnvelope {
  return {
    status: 'success',
    filesTouched: [],
    commandsRun: [],
    exitCode: 0,
    costUsd: 0.05,
    sessionId: 's1',
    model: 'sonnet',
    usage: { input_tokens: 100, output_tokens: 50 },
    raw: { lastAssistantText: '1. step a\n2. step b\n3. step c' },
    ...partial,
  };
}

function makeHandle(envelope: FCEnvelope): FCHandle {
  const result: FCRunResult = { envelope, events: [], exitCode: envelope.exitCode };
  return {
    async *events() {},
    async complete() { return result; },
    abort() {},
  };
}

function makeRunner(envelopes: FCEnvelope[]): jest.Mock {
  let call = 0;
  return vi.fn((_opts: FCRunOptions) => makeHandle(envelopes[call++] ?? envelopes[envelopes.length - 1]));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pyrfor-fc-best-of-n', () => {
  it('N=3 happy path: scores 50, 80, 70 → winner is branch 1', async () => {
    const envelopes = [
      makeEnvelope({ costUsd: 0.01 }),
      makeEnvelope({ costUsd: 0.02 }),
      makeEnvelope({ costUsd: 0.03 }),
    ];
    const scores = [50, 80, 70];
    let scoreCall = 0;
    const scoreFn = async (_env: FCEnvelope, _dir: string) => ({
      total: scores[scoreCall++],
      breakdown: {},
    });

    const opts: BestOfNOptions = {
      prompt: 'test prompt',
      workdir: '/work',
      n: 3,
      fcRunner: makeRunner(envelopes) as any,
      scoreFn,
    };

    const result = await runBestOfN(opts);

    expect(result.winner.i).toBe(1);
    expect(result.winner.score.total).toBe(80);
    expect(result.branches).toHaveLength(3);
    expect(result.totalCostUsd).toBeCloseTo(0.06);
  });

  it('ties on score: earliest index wins', async () => {
    const envelopes = [makeEnvelope(), makeEnvelope(), makeEnvelope()];
    const scoreFn = async () => ({ total: 75, breakdown: {} });

    const result = await runBestOfN({
      prompt: 'test',
      workdir: '/work',
      n: 3,
      fcRunner: makeRunner(envelopes) as any,
      scoreFn,
    });

    expect(result.winner.i).toBe(0);
  });

  it('one branch throws → recorded with error and score 0, others win', async () => {
    let call = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle => {
      const i = call++;
      if (i === 1) {
        return {
          async *events() {},
          async complete(): Promise<FCRunResult> { throw new Error('branch 1 exploded'); },
          abort() {},
        };
      }
      const score = i === 0 ? 60 : 40;
      return makeHandle(makeEnvelope({ costUsd: 0.05 }));
    });

    let scoreCall = 0;
    const scores = [60, 40];
    const scoreFn = async () => ({ total: scores[scoreCall++] ?? 0, breakdown: {} });

    const result = await runBestOfN({
      prompt: 'p',
      workdir: '/w',
      n: 3,
      fcRunner: fcRunner as any,
      scoreFn,
    });

    const failed = result.branches.find((b) => b.i === 1);
    expect(failed?.error).toBeDefined();
    expect(failed?.score.total).toBe(0);
    expect(result.winner.i).not.toBe(1);
    expect(result.branches).toHaveLength(3);
  });

  it('parallelism=1: branches run sequentially (tracked via call order)', async () => {
    const order: number[] = [];
    let call = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle => {
      const i = call++;
      order.push(i);
      return makeHandle(makeEnvelope());
    });

    await runBestOfN({
      prompt: 'p',
      workdir: '/w',
      n: 3,
      parallelism: 1,
      fcRunner: fcRunner as any,
      scoreFn: async () => ({ total: 10, breakdown: {} }),
    });

    expect(fcRunner).toHaveBeenCalledTimes(3);
    expect(order).toEqual([0, 1, 2]);
  });

  it('per-branch models are forwarded to fcRunner', async () => {
    const models = ['model-a', 'model-b', 'model-c'];
    const calls: string[] = [];
    const fcRunner = vi.fn((opts: FCRunOptions): FCHandle => {
      calls.push(opts.model ?? '');
      return makeHandle(makeEnvelope());
    });

    await runBestOfN({
      prompt: 'p',
      workdir: '/w',
      n: 3,
      models,
      fcRunner: fcRunner as any,
      scoreFn: async () => ({ total: 10, breakdown: {} }),
    });

    expect(calls).toEqual(models);
  });

  it('custom branchWorkdir is applied', async () => {
    const usedDirs: string[] = [];
    const fcRunner = vi.fn((opts: FCRunOptions): FCHandle => {
      usedDirs.push(opts.workdir ?? '');
      return makeHandle(makeEnvelope());
    });

    await runBestOfN({
      prompt: 'p',
      workdir: '/base',
      n: 2,
      branchWorkdir: (i) => `/custom/branch-${i}`,
      fcRunner: fcRunner as any,
      scoreFn: async () => ({ total: 10, breakdown: {} }),
    });

    expect(usedDirs).toEqual(['/custom/branch-0', '/custom/branch-1']);
  });

  it('totalCostUsd sums all branches including failed', async () => {
    let call = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle => {
      const i = call++;
      if (i === 1) {
        return {
          async *events() {},
          async complete(): Promise<FCRunResult> { throw new Error('fail'); },
          abort() {},
        };
      }
      return makeHandle(makeEnvelope({ costUsd: 0.10 }));
    });

    const result = await runBestOfN({
      prompt: 'p',
      workdir: '/w',
      n: 3,
      fcRunner: fcRunner as any,
      scoreFn: async () => ({ total: 5, breakdown: {} }),
    });

    // branch 0: 0.10, branch 1: 0 (failed), branch 2: 0.10
    expect(result.totalCostUsd).toBeCloseTo(0.20);
  });
});
