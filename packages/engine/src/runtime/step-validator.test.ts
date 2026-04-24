// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  VERDICT_RANK,
  strongestVerdict,
  runValidators,
  type StepValidator,
  type ValidatorContext,
  type ValidatorResult,
  type ValidatorVerdict,
} from './step-validator.js';
import type { AcpEvent } from './acp-client.js';

const mkEvt = (type: AcpEvent['type'], data: unknown = {}): AcpEvent => ({
  sessionId: 's1',
  type,
  data,
  ts: Date.now(),
});

const mkCtx = (overrides: Partial<ValidatorContext> = {}): ValidatorContext => ({
  cwd: '/tmp/test',
  ...overrides,
});

const passValidator = (name = 'pass-v'): StepValidator => ({
  name,
  appliesTo: () => true,
  validate: async (): Promise<ValidatorResult> => ({
    validator: name,
    verdict: 'pass',
    message: 'ok',
    durationMs: 1,
  }),
});

const verdictValidator = (v: ValidatorVerdict, name = `v-${v}`): StepValidator => ({
  name,
  appliesTo: () => true,
  validate: async (): Promise<ValidatorResult> => ({
    validator: name,
    verdict: v,
    message: v,
    durationMs: 1,
  }),
});

const throwingValidator = (name = 'throw-v'): StepValidator => ({
  name,
  appliesTo: () => true,
  validate: async (): Promise<ValidatorResult> => {
    throw new Error('intentional error');
  },
});

const nonApplicableValidator = (name = 'na-v'): StepValidator => ({
  name,
  appliesTo: () => false,
  validate: async (): Promise<ValidatorResult> => ({
    validator: name,
    verdict: 'block',
    message: 'should not run',
    durationMs: 0,
  }),
});

describe('VERDICT_RANK', () => {
  it('has correct ordering: pass < warn < correct < block', () => {
    expect(VERDICT_RANK.pass).toBe(0);
    expect(VERDICT_RANK.warn).toBe(1);
    expect(VERDICT_RANK.correct).toBe(2);
    expect(VERDICT_RANK.block).toBe(3);
  });

  it('ordering is strictly increasing', () => {
    expect(VERDICT_RANK.pass).toBeLessThan(VERDICT_RANK.warn);
    expect(VERDICT_RANK.warn).toBeLessThan(VERDICT_RANK.correct);
    expect(VERDICT_RANK.correct).toBeLessThan(VERDICT_RANK.block);
  });
});

describe('strongestVerdict', () => {
  it('returns pass for empty array', () => {
    expect(strongestVerdict([])).toBe('pass');
  });

  it('returns the single verdict for single-item array', () => {
    expect(strongestVerdict(['warn'])).toBe('warn');
    expect(strongestVerdict(['block'])).toBe('block');
  });

  it('returns strongest from mixed inputs', () => {
    expect(strongestVerdict(['pass', 'warn', 'correct', 'block'])).toBe('block');
    expect(strongestVerdict(['pass', 'warn', 'correct'])).toBe('correct');
    expect(strongestVerdict(['pass', 'warn'])).toBe('warn');
  });

  it('handles duplicates correctly', () => {
    expect(strongestVerdict(['pass', 'pass', 'pass'])).toBe('pass');
    expect(strongestVerdict(['block', 'block'])).toBe('block');
  });
});

describe('runValidators', () => {
  it('returns pass with empty results when no validators given', async () => {
    const result = await runValidators({
      validators: [],
      event: mkEvt('tool_call'),
      ctx: mkCtx(),
    });
    expect(result.verdict).toBe('pass');
    expect(result.results).toHaveLength(0);
  });

  it('skips non-applicable validators silently', async () => {
    const result = await runValidators({
      validators: [nonApplicableValidator()],
      event: mkEvt('tool_call'),
      ctx: mkCtx(),
    });
    expect(result.verdict).toBe('pass');
    expect(result.results).toHaveLength(0);
  });

  it('runs validators in parallel by default', async () => {
    const order: number[] = [];
    const slow = (n: number): StepValidator => ({
      name: `v${n}`,
      appliesTo: () => true,
      validate: async (): Promise<ValidatorResult> => {
        order.push(n);
        return { validator: `v${n}`, verdict: 'pass', message: '', durationMs: 1 };
      },
    });
    await runValidators({
      validators: [slow(1), slow(2), slow(3)],
      event: mkEvt('diff'),
      ctx: mkCtx(),
      parallel: true,
    });
    expect(order).toHaveLength(3);
  });

  it('runs validators sequentially when parallel=false', async () => {
    const order: number[] = [];
    const makeV = (n: number): StepValidator => ({
      name: `v${n}`,
      appliesTo: () => true,
      validate: async (): Promise<ValidatorResult> => {
        order.push(n);
        return { validator: `v${n}`, verdict: 'pass', message: '', durationMs: 1 };
      },
    });
    await runValidators({
      validators: [makeV(1), makeV(2), makeV(3)],
      event: mkEvt('diff'),
      ctx: mkCtx(),
      parallel: false,
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('validator throws → result has warn verdict, does not poison overall', async () => {
    const result = await runValidators({
      validators: [throwingValidator(), passValidator()],
      event: mkEvt('tool_call'),
      ctx: mkCtx(),
    });
    expect(result.results).toHaveLength(2);
    const thrown = result.results.find((r) => r.validator === 'throw-v')!;
    expect(thrown.verdict).toBe('warn');
    expect(thrown.message).toContain('validator threw:');
    expect(thrown.message).toContain('intentional error');
  });

  it('strongest verdict bubbles up correctly', async () => {
    const result = await runValidators({
      validators: [
        verdictValidator('pass'),
        verdictValidator('warn'),
        verdictValidator('correct'),
      ],
      event: mkEvt('tool_call'),
      ctx: mkCtx(),
    });
    expect(result.verdict).toBe('correct');
  });

  it('preserves per-validator results array', async () => {
    const result = await runValidators({
      validators: [passValidator('a'), verdictValidator('warn', 'b')],
      event: mkEvt('diff'),
      ctx: mkCtx(),
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.validator)).toContain('a');
    expect(result.results.map((r) => r.validator)).toContain('b');
  });

  it('abort before run → verdict=block, message=aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runValidators({
      validators: [passValidator()],
      event: mkEvt('tool_call'),
      ctx: mkCtx({ abortSignal: ac.signal }),
    });
    expect(result.verdict).toBe('block');
    expect(result.results[0]!.message).toBe('aborted');
  });

  it('abort during sequential run → verdict=block', async () => {
    const ac = new AbortController();
    const makeV = (n: number): StepValidator => ({
      name: `sv${n}`,
      appliesTo: () => true,
      validate: async (): Promise<ValidatorResult> => {
        if (n === 1) ac.abort();
        return { validator: `sv${n}`, verdict: 'pass', message: '', durationMs: 1 };
      },
    });
    const result = await runValidators({
      validators: [makeV(1), makeV(2)],
      event: mkEvt('diff'),
      ctx: mkCtx({ abortSignal: ac.signal }),
      parallel: false,
    });
    expect(result.verdict).toBe('block');
  });

  it('ctx is passed through to validate', async () => {
    let receivedCtx: ValidatorContext | null = null;
    const ctxCapture: StepValidator = {
      name: 'ctx-capture',
      appliesTo: () => true,
      validate: async (_e, c): Promise<ValidatorResult> => {
        receivedCtx = c;
        return { validator: 'ctx-capture', verdict: 'pass', message: '', durationMs: 1 };
      },
    };
    const ctx = mkCtx({ task: 'test-task' });
    await runValidators({ validators: [ctxCapture], event: mkEvt('diff'), ctx });
    expect(receivedCtx).toBe(ctx);
  });

  it('durationMs is populated in results', async () => {
    const result = await runValidators({
      validators: [passValidator()],
      event: mkEvt('tool_call'),
      ctx: mkCtx(),
    });
    expect(typeof result.results[0]!.durationMs).toBe('number');
    expect(result.results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});
