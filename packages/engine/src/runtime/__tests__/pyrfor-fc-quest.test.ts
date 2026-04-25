// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runQuest } from '../pyrfor-fc-quest';
import type { QuestOptions, QuestSpec } from '../pyrfor-fc-quest';
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

describe('pyrfor-fc-quest', () => {
  it('3-step happy path: all steps succeed, success=true, costs sum', async () => {
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle =>
      makeHandle(makeEnvelope({ costUsd: 0.10 })),
    );

    const spec: QuestSpec = {
      name: 'my-quest',
      steps: [
        { id: 'step1', prompt: 'do step 1' },
        { id: 'step2', prompt: 'do step 2' },
        { id: 'step3', prompt: 'do step 3' },
      ],
    };

    const result = await runQuest({
      spec,
      workdir: '/w',
      fcRunner: fcRunner as any,
    });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.success)).toBe(true);
    expect(result.totalCostUsd).toBeCloseTo(0.30);
  });

  it('step 2 fails after retries=2 → success=false, step 3 never runs', async () => {
    let call = 0;
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle => {
      const i = call++;
      // step 1: success; steps 2–4 (retries): failure
      if (i === 0) return makeHandle(makeEnvelope());
      return makeHandle(makeEnvelope({ status: 'error', error: 'fail' }));
    });

    const spec: QuestSpec = {
      name: 'q',
      steps: [
        { id: 'step1', prompt: 'step 1' },
        { id: 'step2', prompt: 'step 2', retries: 2 },
        { id: 'step3', prompt: 'step 3' },
      ],
    };

    const result = await runQuest({
      spec,
      workdir: '/w',
      fcRunner: fcRunner as any,
    });

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2); // step3 never ran
    const failedStep = result.steps.find((s) => s.id === 'step2');
    expect(failedStep?.success).toBe(false);
    expect(failedStep?.attempts).toBe(3); // 1 initial + 2 retries
    expect(result.steps.find((s) => s.id === 'step3')).toBeUndefined();
  });

  it('{{templateVars}} placeholders are substituted in step prompt', async () => {
    const usedPrompts: string[] = [];
    const fcRunner = vi.fn((opts: FCRunOptions): FCHandle => {
      usedPrompts.push(opts.prompt);
      return makeHandle(makeEnvelope());
    });

    const spec: QuestSpec = {
      name: 'q',
      steps: [{ id: 's1', prompt: 'work on {{repoName}} in {{branch}}' }],
    };

    await runQuest({
      spec,
      workdir: '/w',
      fcRunner: fcRunner as any,
      templateVars: { repoName: 'my-repo', branch: 'main' },
    });

    expect(usedPrompts[0]).toBe('work on my-repo in main');
  });

  it('{{prev.lastFile}} is substituted from prior envelope.filesTouched', async () => {
    const usedPrompts: string[] = [];
    let call = 0;
    const fcRunner = vi.fn((opts: FCRunOptions): FCHandle => {
      usedPrompts.push(opts.prompt);
      const env = call++ === 0
        ? makeEnvelope({ filesTouched: ['src/foo.ts', 'src/bar.ts'] })
        : makeEnvelope();
      return makeHandle(env);
    });

    const spec: QuestSpec = {
      name: 'q',
      steps: [
        { id: 's1', prompt: 'write a file' },
        { id: 's2', prompt: 'review {{prev.lastFile}}' },
      ],
    };

    await runQuest({
      spec,
      workdir: '/w',
      fcRunner: fcRunner as any,
    });

    expect(usedPrompts[1]).toBe('review src/bar.ts');
  });

  it('successCriteria=()=>false retries exactly `retries` times', async () => {
    const fcRunner = vi.fn((_opts: FCRunOptions): FCHandle =>
      makeHandle(makeEnvelope()),
    );

    const spec: QuestSpec = {
      name: 'q',
      steps: [
        {
          id: 's1',
          prompt: 'do it',
          retries: 3,
          successCriteria: () => false,
        },
      ],
    };

    const result = await runQuest({
      spec,
      workdir: '/w',
      fcRunner: fcRunner as any,
    });

    // 1 initial + 3 retries = 4 total attempts
    expect(result.steps[0].attempts).toBe(4);
    expect(result.steps[0].success).toBe(false);
    expect(result.success).toBe(false);
    expect(fcRunner).toHaveBeenCalledTimes(4);
  });
});
