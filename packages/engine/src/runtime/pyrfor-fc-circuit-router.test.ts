// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createFreeClaudeCircuitHandle, runFreeClaudeWithCircuit } from './pyrfor-fc-circuit-router';
import type { FcCircuitRouterOptions, CircuitRoutedResult } from './pyrfor-fc-circuit-router';
import type { FCEvent, FCHandle, FCEnvelope, FCRunOptions, FCRunResult } from './pyrfor-fc-adapter';
import { CircuitBreaker, CircuitOpenError } from '../ai/circuit-breaker';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<FCEnvelope> = {}): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: [],
    commandsRun: [],
    raw: {},
    ...overrides,
  };
}

function makeHandle(envelope: Partial<FCEnvelope> = {}): FCHandle {
  const full = makeEnvelope(envelope);
  return {
    async *events() {},
    async complete(): Promise<FCRunResult> {
      return { envelope: full, events: [], exitCode: full.exitCode };
    },
    abort: vi.fn(),
  };
}

function makeEvent(name: string): FCEvent {
  return { type: 'wrapper_event', name, raw: { name } };
}

function makeEventHandle(events: FCEvent[], envelope: Partial<FCEnvelope> = {}): FCHandle {
  const full = makeEnvelope(envelope);
  return {
    async *events() {
      for (const event of events) {
        yield event;
      }
    },
    async complete(): Promise<FCRunResult> {
      return { envelope: full, events, exitCode: full.exitCode };
    },
    abort: vi.fn(),
  };
}

async function collectEvents(handle: FCHandle): Promise<FCEvent[]> {
  const events: FCEvent[] = [];
  for await (const event of handle.events()) {
    events.push(event);
  }
  return events;
}

/**
 * Build a model-aware runFn: given a map of model → envelope (or error),
 * returns the corresponding result or throws.
 */
function makeRunFn(
  modelBehavior: Record<string, Partial<FCEnvelope> | { throw: string }>,
) {
  return vi.fn((opts: { model?: string }): FCHandle => {
    const model = opts.model ?? 'unknown';
    const spec = modelBehavior[model] ?? { status: 'success' };
    if ('throw' in spec) {
      return {
        async *events() {},
        async complete(): Promise<FCRunResult> {
          throw new Error((spec as { throw: string }).throw);
        },
        abort: vi.fn(),
      };
    }
    return makeHandle(spec as Partial<FCEnvelope>);
  });
}

/** Creates a CircuitBreaker whose execute() always throws CircuitOpenError. */
function makeOpenBreaker(model: string): CircuitBreaker {
  const breaker = new CircuitBreaker(`open-${model}`, {
    failureThreshold: 1,
    resetTimeout: 999_999_999,
    halfOpenMax: 2,
    executionTimeoutMs: 45_000,
  });
  // Trip it open by injecting failures directly via execute
  // We override execute to always throw CircuitOpenError
  const stub = Object.create(breaker) as CircuitBreaker;
  stub.execute = async () => {
    throw new CircuitOpenError(`fc-model-${model}`);
  };
  return stub;
}

/** Creates a CircuitBreaker that transparently executes fns (normal behaviour). */
function makeNormalBreaker(model: string): CircuitBreaker {
  return new CircuitBreaker(`normal-${model}`, {
    failureThreshold: 3,
    resetTimeout: 30_000,
    halfOpenMax: 2,
    executionTimeoutMs: 45_000,
  });
}

function makeRouter(overrides: Partial<FcCircuitRouterOptions> = {}): FcCircuitRouterOptions {
  return {
    modelChain: ['model-a', 'model-b'],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFreeClaudeWithCircuit', () => {
  it('1. first model success → returns result, attempt status success', async () => {
    const runFn = makeRunFn({ 'model-a': { status: 'success', output: 'hello' } });
    const breakerMap: Record<string, CircuitBreaker> = {};
    const getBreaker = vi.fn((name: string) => {
      if (!breakerMap[name]) breakerMap[name] = makeNormalBreaker(name);
      return breakerMap[name];
    });

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker }),
    );

    expect(result.modelUsed).toBe('model-a');
    expect(result.envelope.status).toBe('success');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toEqual({ model: 'model-a', status: 'success' });
  });

  it('2. first model fails → second model tried; final modelUsed = second', async () => {
    const runFn = makeRunFn({
      'model-a': { status: 'error', error: 'provider error' },
      'model-b': { status: 'success', output: 'ok' },
    });
    const getBreaker = vi.fn((name: string) => makeNormalBreaker(name));

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker }),
    );

    expect(result.modelUsed).toBe('model-b');
    expect(result.envelope.status).toBe('success');
    expect(result.attempts[0].model).toBe('model-a');
    expect(result.attempts[0].status).toBe('failure');
    expect(result.attempts[1].model).toBe('model-b');
    expect(result.attempts[1].status).toBe('success');
  });

  it('3. first model circuit open → skipped, second tried successfully', async () => {
    const runFn = makeRunFn({ 'model-b': { status: 'success' } });
    const getBreaker = vi.fn((name: string) => {
      if (name === 'fc-model-model-a') return makeOpenBreaker('model-a');
      return makeNormalBreaker(name);
    });

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker }),
    );

    expect(result.modelUsed).toBe('model-b');
    expect(result.attempts[0]).toEqual(
      expect.objectContaining({ model: 'model-a', status: 'circuit_open' }),
    );
    expect(result.attempts[1]).toEqual(
      expect.objectContaining({ model: 'model-b', status: 'success' }),
    );
  });

  it('4. all circuits open → returns synthetic error envelope, all attempts circuit_open', async () => {
    const runFn = vi.fn();
    const getBreaker = vi.fn((name: string) => makeOpenBreaker(name));

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ modelChain: ['model-a', 'model-b'], runFn, getBreaker }),
    );

    expect(result.envelope.status).toBe('error');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => a.status === 'circuit_open')).toBe(true);
    expect(runFn).not.toHaveBeenCalled();
  });

  it('5. all models fail → returns last envelope, all attempts failure', async () => {
    const runFn = makeRunFn({
      'model-a': { status: 'error', error: 'error-a' },
      'model-b': { status: 'error', error: 'error-b' },
    });
    const getBreaker = vi.fn((name: string) => makeNormalBreaker(name));

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker }),
    );

    expect(result.envelope.status).toBe('error');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => a.status === 'failure')).toBe(true);
    // last envelope should come from model-b's run
    expect(result.envelope.error).toMatch(/error-b/);
  });

  it('6. onFailover called with correct fromModel/toModel/reason', async () => {
    const runFn = makeRunFn({
      'model-a': { status: 'error', error: 'overload' },
      'model-b': { status: 'success' },
    });
    const getBreaker = vi.fn((name: string) => makeNormalBreaker(name));
    const onFailover = vi.fn();

    await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker, onFailover }),
    );

    expect(onFailover).toHaveBeenCalledOnce();
    const [fromModel, toModel, reason] = onFailover.mock.calls[0];
    expect(fromModel).toBe('model-a');
    expect(toModel).toBe('model-b');
    expect(typeof reason).toBe('string');
  });

  it('7. envelope.error "429 rate limit" → counted as failure, failover triggers', async () => {
    const runFn = makeRunFn({
      'model-a': { status: 'error', error: '429 rate limit exceeded' },
      'model-b': { status: 'success', output: 'fallback ok' },
    });
    const getBreaker = vi.fn((name: string) => makeNormalBreaker(name));
    const onFailover = vi.fn();

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker, onFailover }),
    );

    expect(result.modelUsed).toBe('model-b');
    expect(result.attempts[0].status).toBe('failure');
    expect(onFailover).toHaveBeenCalled();
  });

  it('8. attempts list has correct chronological order', async () => {
    const runFn = makeRunFn({
      'model-a': { status: 'error', error: 'fail-a' },
      'model-b': { status: 'error', error: 'fail-b' },
      'model-c': { status: 'success' },
    });
    const getBreaker = vi.fn((name: string) => makeNormalBreaker(name));

    const result = await runFreeClaudeWithCircuit(
      { prompt: 'hi' },
      makeRouter({ modelChain: ['model-a', 'model-b', 'model-c'], runFn, getBreaker }),
    );

    expect(result.attempts.map((a) => a.model)).toEqual(['model-a', 'model-b', 'model-c']);
    expect(result.attempts[0].status).toBe('failure');
    expect(result.attempts[1].status).toBe('failure');
    expect(result.attempts[2].status).toBe('success');
    expect(result.modelUsed).toBe('model-c');
  });
});

describe('createFreeClaudeCircuitHandle', () => {
  it('replays first successful model events', async () => {
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      expect(opts.model).toBe('model-a');
      return makeEventHandle([makeEvent('a-ok')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker: (name) => makeNormalBreaker(name) }),
    );

    await expect(collectEvents(handle)).resolves.toEqual([makeEvent('a-ok')]);
    const result = await handle.completeCircuit();
    expect(result.modelUsed).toBe('model-a');
    expect(result.attempts).toEqual([{ model: 'model-a', status: 'success' }]);
    expect(runFn).toHaveBeenCalledOnce();
  });

  it('discards failed attempt events and replays only the winning model', async () => {
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      if (opts.model === 'model-a') {
        return makeEventHandle([makeEvent('a-leaked-if-bug')], { status: 'error', error: 'model-a failed' });
      }
      return makeEventHandle([makeEvent('b-winner')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker: (name) => makeNormalBreaker(name) }),
    );

    const events = await collectEvents(handle);
    expect(events.map((event) => event.type === 'wrapper_event' ? event.name : '')).toEqual(['b-winner']);
    const result = await handle.completeCircuit();
    expect(result.modelUsed).toBe('model-b');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failure', 'success']);
  });

  it('returns the last failed envelope when all buffered attempts fail', async () => {
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      if (opts.model === 'model-a') {
        return makeEventHandle([makeEvent('a-failed')], { status: 'error', error: 'error-a' });
      }
      return makeEventHandle([makeEvent('b-failed')], { status: 'error', error: 'error-b' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker: (name) => makeNormalBreaker(name) }),
    );

    await expect(collectEvents(handle)).resolves.toEqual([]);
    const result = await handle.completeCircuit();
    expect(result.envelope).toMatchObject({ status: 'error', error: 'error-b' });
    expect(result.modelUsed).toBe('model-b');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failure', 'failure']);
  });

  it('skips open circuits without spawning their model', async () => {
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      expect(opts.model).toBe('model-b');
      return makeEventHandle([makeEvent('b-after-open')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        runFn,
        getBreaker: (name) => name === 'fc-model-model-a' ? makeOpenBreaker('model-a') : makeNormalBreaker(name),
      }),
    );

    await expect(collectEvents(handle)).resolves.toEqual([makeEvent('b-after-open')]);
    const result = await handle.completeCircuit();
    expect(result.attempts[0]).toMatchObject({ model: 'model-a', status: 'circuit_open' });
    expect(result.attempts[1]).toMatchObject({ model: 'model-b', status: 'success' });
    expect(runFn).toHaveBeenCalledOnce();
  });

  it('treats event validation failure as terminal and does not fail over', async () => {
    const abort = vi.fn();
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      if (opts.model === 'model-a') {
        return {
          ...makeEventHandle([makeEvent('a-invalid')], { status: 'success' }),
          abort,
        };
      }
      return makeEventHandle([makeEvent('b-should-not-run')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        runFn,
        getBreaker: (name) => makeNormalBreaker(name),
        validateEvent: () => {
          throw new Error('strict validation failed');
        },
      }),
    );

    await expect(collectEvents(handle)).resolves.toEqual([]);
    const result = await handle.completeCircuit();
    expect(result.envelope).toMatchObject({ status: 'error', error: 'strict validation failed' });
    expect(result.attempts).toEqual([
      { model: 'model-a', status: 'failure', error: 'strict validation failed' },
    ]);
    expect(runFn).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledWith('strict validation failed');
  });

  it('does not count terminal validation failures against model circuit health', async () => {
    const breakerMap: Record<string, CircuitBreaker> = {};
    const getBreaker = (name: string) => {
      breakerMap[name] ??= new CircuitBreaker(name, {
        failureThreshold: 1,
        resetTimeout: 999_999_999,
        halfOpenMax: 2,
        executionTimeoutMs: 45_000,
      });
      return breakerMap[name];
    };
    let rejectEvents = true;
    const runFn = vi.fn((): FCHandle => makeEventHandle(
      [makeEvent(rejectEvents ? 'invalid' : 'valid')],
      { status: 'success' },
    ));

    const failedHandle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        modelChain: ['model-a'],
        runFn,
        getBreaker,
        validateEvent: () => {
          if (rejectEvents) throw new Error('strict validation failed');
        },
      }),
    );

    await expect(collectEvents(failedHandle)).resolves.toEqual([]);
    expect((await failedHandle.completeCircuit()).envelope.error).toBe('strict validation failed');
    rejectEvents = false;

    const successfulHandle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        modelChain: ['model-a'],
        runFn,
        getBreaker,
        validateEvent: () => {
          if (rejectEvents) throw new Error('strict validation failed');
        },
      }),
    );

    await expect(collectEvents(successfulHandle)).resolves.toEqual([makeEvent('valid')]);
    expect((await successfulHandle.completeCircuit()).attempts).toEqual([
      { model: 'model-a', status: 'success' },
    ]);
    expect(runFn).toHaveBeenCalledTimes(2);
  });

  it('treats beforeAttempt denial as terminal and does not spawn that model', async () => {
    const beforeAttempt = vi.fn((ctx: { model: string }) => {
      if (ctx.model === 'model-b') {
        throw new Error('budget denied: daily-limit');
      }
    });
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      if (opts.model === 'model-a') {
        return makeEventHandle([makeEvent('a-failed')], { status: 'error', error: 'error-a' });
      }
      return makeEventHandle([makeEvent('b-should-not-spawn')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        runFn,
        getBreaker: (name) => makeNormalBreaker(name),
        beforeAttempt,
      }),
    );

    await expect(collectEvents(handle)).resolves.toEqual([]);
    const result = await handle.completeCircuit();
    expect(result.envelope).toMatchObject({ status: 'error', error: 'budget denied: daily-limit' });
    expect(result.attempts).toEqual([
      { model: 'model-a', status: 'failure', error: 'error-a' },
      { model: 'model-b', status: 'failure', error: 'budget denied: daily-limit' },
    ]);
    expect(runFn).toHaveBeenCalledOnce();
    expect(runFn.mock.calls[0][0].model).toBe('model-a');
  });

  it('treats abort as terminal and does not spawn another model', async () => {
    const runFn = vi.fn((): FCHandle => makeEventHandle([makeEvent('should-not-replay')], { status: 'success' }));
    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({ runFn, getBreaker: (name) => makeNormalBreaker(name) }),
    );

    handle.abort('user abort');

    await expect(collectEvents(handle)).resolves.toEqual([]);
    const result = await handle.completeCircuit();
    expect(result.envelope).toMatchObject({ status: 'error', error: 'user abort' });
    expect(runFn).not.toHaveBeenCalled();
  });

  it('calls onAttemptComplete for failed and successful attempts', async () => {
    const onAttemptComplete = vi.fn();
    const runFn = vi.fn((opts: FCRunOptions): FCHandle => {
      if (opts.model === 'model-a') {
        return makeEventHandle([], { status: 'error', error: 'failed attempt usage' });
      }
      return makeEventHandle([makeEvent('b-ok')], { status: 'success' });
    });

    const handle = createFreeClaudeCircuitHandle(
      { prompt: 'hi' },
      makeRouter({
        runFn,
        getBreaker: (name) => makeNormalBreaker(name),
        onAttemptComplete,
      }),
    );

    await collectEvents(handle);
    expect(onAttemptComplete).toHaveBeenCalledTimes(2);
    expect(onAttemptComplete.mock.calls.map(([, ctx]) => ctx.model)).toEqual(['model-a', 'model-b']);
  });
});
