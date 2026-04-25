// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runPlanAct } from '../pyrfor-fc-plan-act';
import type { PlanActOptions } from '../pyrfor-fc-plan-act';
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pyrfor-fc-plan-act', () => {
  it('happy path: plan stage produces 3-step plan, act stage runs with composed prompt', async () => {
    const planEnv = makeEnvelope({
      costUsd: 0.03,
      raw: { lastAssistantText: '1. step a\n2. step b\n3. step c' },
    });
    const actEnv = makeEnvelope({ costUsd: 0.07 });
    let callCount = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle => {
      return makeHandle(callCount++ === 0 ? planEnv : actEnv);
    });

    const result = await runPlanAct({
      task: 'Build a widget',
      workdir: '/work',
      fcRunner: fcRunner as any,
      planModel: 'sonnet',
      actModel: 'haiku',
    });

    expect(result.plan).toEqual(['step a', 'step b', 'step c']);
    expect(result.planEnvelope).toBe(planEnv);
    expect(result.actEnvelope).toBe(actEnv);
    expect(result.totalCostUsd).toBeCloseTo(0.10);
    expect(fcRunner).toHaveBeenCalledTimes(2);
  });

  it('default parsePlan extracts numbered lines', async () => {
    const planEnv = makeEnvelope({
      raw: { lastAssistantText: 'Preamble\n1. first\n2. second\nFooter' },
    });
    const actEnv = makeEnvelope();
    let callCount = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions) => makeHandle(callCount++ === 0 ? planEnv : actEnv));

    const result = await runPlanAct({
      task: 'task',
      workdir: '/w',
      fcRunner: fcRunner as any,
      planModel: 'm1',
      actModel: 'm2',
    });

    expect(result.plan).toEqual(['first', 'second']);
  });

  it('custom parsePlan is honored', async () => {
    const planEnv = makeEnvelope({
      raw: { lastAssistantText: 'a|b|c' },
    });
    const actEnv = makeEnvelope();
    let callCount = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions) => makeHandle(callCount++ === 0 ? planEnv : actEnv));

    const result = await runPlanAct({
      task: 'task',
      workdir: '/w',
      fcRunner: fcRunner as any,
      planModel: 'm1',
      actModel: 'm2',
      parsePlan: (text) => text.split('|'),
    });

    expect(result.plan).toEqual(['a', 'b', 'c']);
  });

  it('planModel and actModel are propagated to respective calls', async () => {
    const calls: string[] = [];
    let callCount = 0;
    const fcRunner = vi.fn((opts: FCRunOptions): FCHandle => {
      calls.push(opts.model ?? '');
      return makeHandle(makeEnvelope({ costUsd: 0.01 }));
    });

    await runPlanAct({
      task: 'task',
      workdir: '/w',
      fcRunner: fcRunner as any,
      planModel: 'claude-plan',
      actModel: 'claude-act',
    });

    expect(calls[0]).toBe('claude-plan');
    expect(calls[1]).toBe('claude-act');
  });

  it('plan stage failure throws and act stage does not run', async () => {
    const planEnv = makeEnvelope({ status: 'error', error: 'plan exploded', costUsd: 0 });
    const fcRunner = vi.fn((_opts: FCRunOptions) => makeHandle(planEnv));

    await expect(
      runPlanAct({
        task: 'task',
        workdir: '/w',
        fcRunner: fcRunner as any,
        planModel: 'm1',
        actModel: 'm2',
      }),
    ).rejects.toThrow(/plan exploded/);

    expect(fcRunner).toHaveBeenCalledTimes(1);
  });

  it('trajectory events are appended for both stages', async () => {
    const planEnv = makeEnvelope({ raw: { lastAssistantText: '1. step a' } });
    const actEnv = makeEnvelope();
    let callCount = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions) => makeHandle(callCount++ === 0 ? planEnv : actEnv));
    const trajectory: any[] = [];

    await runPlanAct({
      task: 'task',
      workdir: '/w',
      fcRunner: fcRunner as any,
      planModel: 'm1',
      actModel: 'm2',
      trajectory: { append: (ev) => trajectory.push(ev) },
    });

    const types = trajectory.map((e) => e.type);
    expect(types).toContain('plan_act_stage_start');
    expect(types).toContain('plan_act_stage_end');
    const planStarts = trajectory.filter((e) => e.type === 'plan_act_stage_start');
    expect(planStarts.some((e) => e.stage === 'plan')).toBe(true);
    expect(planStarts.some((e) => e.stage === 'act')).toBe(true);
  });
});
