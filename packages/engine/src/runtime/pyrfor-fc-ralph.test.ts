// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { FCHandle, FCEnvelope, FCRunOptions } from './pyrfor-fc-adapter.js';
import { runRalphFc } from './pyrfor-fc-ralph.js';
import type { IterationResult } from './pyrfor-fc-ralph.js';
import type { StruggleDetector } from './pyrfor-fc-struggle-detect.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<FCEnvelope> = {}): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: ['src/foo.ts'],
    commandsRun: [],
    costUsd: 0.05,
    sessionId: 'sess-1',
    durationMs: 500,
    raw: {},
    ...overrides,
  };
}

function makeHandle(envelope: FCEnvelope): FCHandle {
  return {
    events(): AsyncIterable<any> {
      return {
        [Symbol.asyncIterator]: async function* () {},
      };
    },
    complete: () =>
      Promise.resolve({ envelope, events: [], exitCode: envelope.exitCode }),
    abort: () => {},
  };
}

/** Creates a fcRunner stub that returns envelopes in sequence (last one repeats). */
function makeRunner(
  envelopes: FCEnvelope[],
  capturedOpts?: FCRunOptions[]
): (opts: FCRunOptions) => FCHandle {
  let idx = 0;
  return (opts: FCRunOptions): FCHandle => {
    capturedOpts?.push(opts);
    const env = envelopes[idx] ?? envelopes[envelopes.length - 1]!;
    idx++;
    return makeHandle(env);
  };
}

/** Score function that returns scores from an array indexed by call count. */
function makeScoreFn(
  scores: number[]
): (env: FCEnvelope, _wd: string) => Promise<{ total: number; breakdown: any }> {
  let idx = 0;
  return async () => {
    const total = scores[idx] ?? scores[scores.length - 1]!;
    idx++;
    return { total, breakdown: { idx } };
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runRalphFc', () => {
  it('happy path: 3 iters 60→75→90, stops on threshold, bestIter=3, totalCostUsd sums', async () => {
    const envs = [
      makeEnvelope({ costUsd: 0.10 }),
      makeEnvelope({ costUsd: 0.15 }),
      makeEnvelope({ costUsd: 0.20 }),
    ];
    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 10,
      scoreThreshold: 85,
      fcRunner: makeRunner(envs),
      scoreFn: makeScoreFn([60, 75, 90]),
    });

    expect(result.stoppedReason).toBe('threshold-reached');
    expect(result.finalIter).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.bestIter.iter).toBe(3);
    expect(result.bestIter.score.total).toBe(90);
    expect(result.totalCostUsd).toBeCloseTo(0.45);
  });

  it('maxIterations cap: scores never reach threshold, stops at max-iter', async () => {
    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 3,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([50, 55, 60]),
    });

    expect(result.stoppedReason).toBe('max-iter');
    expect(result.finalIter).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.history[2]!.abortReason).toBe('max-iter');
  });

  it('struggle stop: detector returns stuck on iter 3 → stoppedReason=struggle', async () => {
    const detector: StruggleDetector = {
      detect: (history) => {
        if (history.length >= 3) return { stuck: true, reason: 'plateau' };
        return { stuck: false };
      },
    };

    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 10,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([60, 61, 60]),
      struggleDetector: detector,
    });

    expect(result.stoppedReason).toBe('struggle');
    expect(result.finalIter).toBe(3);
    expect(result.history[2]!.abortReason).toBe('struggle');
  });

  it('fatal envelope (exitCode=1, status=error) → stoppedReason=fatal, loop exits', async () => {
    const fatalEnv = makeEnvelope({ status: 'error', exitCode: 1, costUsd: null });
    const scoreFn = vi.fn();

    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 5,
      scoreThreshold: 80,
      fcRunner: makeRunner([fatalEnv]),
      scoreFn,
    });

    expect(result.stoppedReason).toBe('fatal');
    expect(result.finalIter).toBe(1);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.abortReason).toBe('fatal');
    // scoreFn should NOT be called for a fatal envelope
    expect(scoreFn).not.toHaveBeenCalled();
  });

  it('buildContextForIteration called with correct iter+history; return forwarded to fcRunner', async () => {
    const capturedOpts: FCRunOptions[] = [];
    const buildCtx = vi.fn()
      .mockResolvedValueOnce({ appendSystemPrompt: 'hint1', resumeSessionId: undefined })
      .mockResolvedValueOnce({ appendSystemPrompt: 'hint2', resumeSessionId: 'sess-prev' });

    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 2,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()], capturedOpts),
      scoreFn: makeScoreFn([50, 60]),
      buildContextForIteration: buildCtx,
    });

    expect(buildCtx).toHaveBeenCalledTimes(2);
    expect(buildCtx).toHaveBeenNthCalledWith(1, 1, []);
    expect(buildCtx).toHaveBeenNthCalledWith(2, 2, [result.history[0]]);

    expect(capturedOpts[0]!.appendSystemPrompt).toBe('hint1');
    expect(capturedOpts[0]!.resume).toBeUndefined();
    expect(capturedOpts[1]!.appendSystemPrompt).toBe('hint2');
    expect(capturedOpts[1]!.resume).toBe('sess-prev');
  });

  it('onIteration callback fires once per iter', async () => {
    const fired: number[] = [];
    await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 3,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([40, 50, 60]),
      onIteration: (r) => fired.push(r.iter),
    });
    expect(fired).toEqual([1, 2, 3]);
  });

  it('trajectory.append called for each iter', async () => {
    const appended: any[] = [];
    await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 3,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([40, 50, 60]),
      trajectory: { append: (ev) => appended.push(ev) },
    });
    expect(appended).toHaveLength(3);
    expect(appended[0]).toMatchObject({ type: 'iteration', iter: 1 });
    expect(appended[1]).toMatchObject({ type: 'iteration', iter: 2 });
    expect(appended[2]).toMatchObject({ type: 'iteration', iter: 3 });
  });

  it('bestIter ties: earliest iter wins', async () => {
    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 3,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([80, 80, 70]),
    });
    expect(result.bestIter.iter).toBe(1);
    expect(result.bestIter.score.total).toBe(80);
  });

  it('single iteration when threshold met on iter 1', async () => {
    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 10,
      scoreThreshold: 80,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([95]),
    });
    expect(result.stoppedReason).toBe('threshold-reached');
    expect(result.finalIter).toBe(1);
    expect(result.history).toHaveLength(1);
    expect(result.bestIter.iter).toBe(1);
  });

  it('model option propagated to fcRunner', async () => {
    const capturedOpts: FCRunOptions[] = [];
    await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 1,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()], capturedOpts),
      scoreFn: makeScoreFn([50]),
      fcModel: 'claude-3-5-sonnet-20241022',
    });
    expect(capturedOpts[0]!.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('earlyStop predicate triggers stoppedReason=struggle', async () => {
    const earlyStop = {
      shouldStop: vi.fn().mockReturnValueOnce({ stop: false }).mockReturnValue({ stop: true, reason: 'custom' }),
    };

    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 10,
      scoreThreshold: 100,
      fcRunner: makeRunner([makeEnvelope()]),
      scoreFn: makeScoreFn([50, 50, 50]),
      earlyStop,
    });

    expect(result.stoppedReason).toBe('struggle');
    expect(result.finalIter).toBe(2);
  });

  it('filesTouched is taken from envelope', async () => {
    const env = makeEnvelope({ filesTouched: ['a.ts', 'b.ts'] });
    const result = await runRalphFc({
      prompt: 'task',
      workdir: '/tmp/proj',
      maxIterations: 1,
      scoreThreshold: 100,
      fcRunner: makeRunner([env]),
      scoreFn: makeScoreFn([50]),
    });
    expect(result.history[0]!.filesTouched).toEqual(['a.ts', 'b.ts']);
  });
});
