// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { FCEvent, FCHandle, FCRunOptions, FCEnvelope } from './pyrfor-fc-adapter';
import type { InjectionPlan } from './pyrfor-fc-control';
import { createFcController } from './pyrfor-fc-control';

// ── Stub helpers ──────────────────────────────────────────────────────────────

interface StubHandleOptions {
  /** Events to yield from events(). */
  events?: FCEvent[];
  /** Partial envelope to merge into complete() result. */
  envelope?: Partial<FCEnvelope>;
}

interface StubHandle extends FCHandle {
  aborted: boolean;
  abortReason?: string;
}

function makeHandle(options: StubHandleOptions = {}): StubHandle {
  let aborted = false;
  let abortReason: string | undefined;
  const evs: FCEvent[] = options.events ?? [];

  const handle: StubHandle = {
    get aborted() {
      return aborted;
    },
    get abortReason() {
      return abortReason;
    },

    async *events(): AsyncIterable<FCEvent> {
      for (const ev of evs) {
        yield ev;
      }
    },

    async complete() {
      const base: FCEnvelope = {
        status: 'success',
        sessionId: null,
        error: null,
        filesTouched: [],
        commandsRun: [],
        exitCode: 0,
        raw: {},
        ...options.envelope,
      };
      if (aborted) {
        base.status = 'error';
        base.error = abortReason ?? 'aborted';
        base.exitCode = 1;
      }
      return { envelope: base, events: evs, exitCode: base.exitCode };
    },

    abort(reason?: string) {
      aborted = true;
      abortReason = reason;
    },
  };

  return handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FcController', () => {
  // 1. start() + await() returns envelope; history has 1 record
  it('start + await returns envelope and records history', async () => {
    const ctrl = createFcController({ runFn: () => makeHandle() });
    const running = ctrl.start({ prompt: 'hello' }, 'task-1');
    const env = await ctrl.await(running);

    expect(env.status).toBe('success');
    expect(ctrl.history()).toHaveLength(1);
    expect(ctrl.history()[0].taskId).toBe('task-1');
    expect(ctrl.history()[0].abortReason).toBeUndefined();
  });

  // 2. abort() records abortReason in history
  it('abort records abortReason in history', async () => {
    const ctrl = createFcController({ runFn: () => makeHandle() });
    const running = ctrl.start({ prompt: 'hello' });
    const env = await ctrl.abort(running, 'too slow');

    expect(env.status).toBe('error');
    expect(ctrl.history()).toHaveLength(1);
    expect(ctrl.history()[0].abortReason).toBe('too slow');
  });

  // 3. inject() without any sessionId throws a clear error
  it('inject without sessionId throws', async () => {
    const ctrl = createFcController({
      runFn: () => makeHandle({ envelope: { sessionId: null } }),
    });
    const running = ctrl.start({ prompt: 'hello' });

    await expect(
      ctrl.inject(running, { correction: 'fix it', reason: 'wrong' }),
    ).rejects.toThrow('cannot inject: no session id captured yet');
  });

  // 4. inject() with sessionId from envelope: aborts old, starts new with correct options
  it('inject with envelope sessionId aborts old and starts new session', async () => {
    const createdHandles: StubHandle[] = [];

    const runFn = () => {
      const h = makeHandle({ envelope: { sessionId: 'sess-abc' } });
      createdHandles.push(h);
      return h;
    };

    const ctrl = createFcController({ runFn });
    const running = ctrl.start({ prompt: 'do work' });
    const plan: InjectionPlan = { correction: 'do better', reason: 'fixing' };
    const newRunning = await ctrl.inject(running, plan);

    // Old handle should have been aborted
    expect(createdHandles[0].aborted).toBe(true);
    expect(createdHandles[0].abortReason).toBe('fixing');

    // New session should use resume + concatenated appendSystemPrompt + default prompt
    expect(newRunning.baseOptions.resume).toBe('sess-abc');
    expect(newRunning.baseOptions.appendSystemPrompt).toContain('[CORRECTION]');
    expect(newRunning.baseOptions.appendSystemPrompt).toContain('do better');
    expect(newRunning.baseOptions.prompt).toBe('Continue with the corrections above.');

    // History should contain the aborted session
    expect(ctrl.history()).toHaveLength(1);
    expect(ctrl.history()[0].abortReason).toBe('fixing');
  });

  // 5. inject() honors plan.model and plan.maxTurns
  it('inject honors plan.model and plan.maxTurns', async () => {
    const runFn = () => makeHandle({ envelope: { sessionId: 'sess-xyz' } });
    const ctrl = createFcController({ runFn });
    const running = ctrl.start({ prompt: 'hello', model: 'old-model', maxTurns: 5 });

    const newRunning = await ctrl.inject(running, {
      correction: 'fix',
      reason: 'r',
      model: 'new-model',
      maxTurns: 10,
    });

    expect(newRunning.baseOptions.model).toBe('new-model');
    expect(newRunning.baseOptions.maxTurns).toBe(10);
  });

  // 6. inject() with custom continuationPrompt
  it('inject uses custom continuationPrompt when provided', async () => {
    const runFn = () => makeHandle({ envelope: { sessionId: 'sess-123' } });
    const ctrl = createFcController({ runFn });
    const running = ctrl.start({ prompt: 'hello' });

    const newRunning = await ctrl.inject(
      running,
      { correction: 'fix', reason: 'r' },
      { continuationPrompt: 'Keep going!' },
    );

    expect(newRunning.baseOptions.prompt).toBe('Keep going!');
  });

  // 7. resumeFromHistory builds correct options
  it('resumeFromHistory builds correct options', async () => {
    const ctrl = createFcController({ runFn: () => makeHandle() });
    const running = ctrl.resumeFromHistory('old-sess', 'continue please', { model: 'fast' });

    expect(running.baseOptions.resume).toBe('old-sess');
    expect(running.baseOptions.prompt).toBe('continue please');
    expect(running.baseOptions.model).toBe('fast');
  });

  // 8. Multiple concurrent sessions can complete independently
  it('multiple concurrent sessions complete independently', async () => {
    const ctrl = createFcController({ runFn: () => makeHandle() });
    const r1 = ctrl.start({ prompt: 'task1' }, 'tid1');
    const r2 = ctrl.start({ prompt: 'task2' }, 'tid2');

    const [e1, e2] = await Promise.all([ctrl.await(r1), ctrl.await(r2)]);

    expect(e1.status).toBe('success');
    expect(e2.status).toBe('success');
    expect(ctrl.history()).toHaveLength(2);

    const taskIds = ctrl.history().map((r) => r.taskId);
    expect(taskIds).toContain('tid1');
    expect(taskIds).toContain('tid2');
  });

  // 9. sessionId captured from result event (raw.sessionId)
  it('captures sessionId from result event raw.sessionId', async () => {
    const events: FCEvent[] = [
      { type: 'result', result: {}, raw: { sessionId: 'result-sess-id' } },
    ];
    const ctrl = createFcController({
      runFn: () => makeHandle({ events, envelope: { sessionId: null } }),
    });
    const running = ctrl.start({ prompt: 'hello' });
    await ctrl.await(running);

    expect(running.sessionId).toBe('result-sess-id');
    expect(ctrl.history()[0].sessionId).toBe('result-sess-id');
  });

  // 10. sessionId captured from wrapper_event raw.sessionId
  it('captures sessionId from wrapper_event raw.sessionId', async () => {
    const events: FCEvent[] = [
      { type: 'wrapper_event', name: 'end', raw: { sessionId: 'wrapper-sess-id' } },
    ];
    const ctrl = createFcController({
      runFn: () => makeHandle({ events, envelope: { sessionId: null } }),
    });
    const running = ctrl.start({ prompt: 'hello' });
    await ctrl.await(running);

    expect(running.sessionId).toBe('wrapper-sess-id');
    expect(ctrl.history()[0].sessionId).toBe('wrapper-sess-id');
  });

  // 11. inject() preserves baseOptions fields not overridden
  it('inject preserves baseOptions fields not overridden by plan', async () => {
    const runFn = () => makeHandle({ envelope: { sessionId: 'sess-789' } });
    const ctrl = createFcController({ runFn });
    const running = ctrl.start({
      prompt: 'hello',
      workdir: '/some/dir',
      allowedTools: ['bash', 'write_file'],
      maxBudgetUsd: 5,
      model: 'base-model',
    });

    const newRunning = await ctrl.inject(running, { correction: 'fix', reason: 'r' });

    expect(newRunning.baseOptions.workdir).toBe('/some/dir');
    expect(newRunning.baseOptions.allowedTools).toEqual(['bash', 'write_file']);
    expect(newRunning.baseOptions.maxBudgetUsd).toBe(5);
    // model not overridden in plan → preserved from baseOptions
    expect(newRunning.baseOptions.model).toBe('base-model');
  });

  // Extra: appendSystemPrompt concatenation when base already has a value
  it('inject concatenates appendSystemPrompt correctly when base has existing value', async () => {
    const runFn = () => makeHandle({ envelope: { sessionId: 'sess-concat' } });
    const ctrl = createFcController({ runFn });
    const running = ctrl.start({
      prompt: 'hello',
      appendSystemPrompt: 'Existing context.',
    });

    const newRunning = await ctrl.inject(running, {
      correction: 'New correction.',
      reason: 'r',
    });

    expect(newRunning.baseOptions.appendSystemPrompt).toBe(
      'Existing context.\n\n[CORRECTION]\nNew correction.',
    );
  });

  // Extra: sessionId capture from result event result.session_id field
  it('captures sessionId from result event result.session_id', async () => {
    const events: FCEvent[] = [
      { type: 'result', result: { session_id: 'deep-sess-id' }, raw: {} },
    ];
    const ctrl = createFcController({
      runFn: () => makeHandle({ events, envelope: { sessionId: null } }),
    });
    const running = ctrl.start({ prompt: 'hello' });
    await ctrl.await(running);

    expect(running.sessionId).toBe('deep-sess-id');
  });
});
