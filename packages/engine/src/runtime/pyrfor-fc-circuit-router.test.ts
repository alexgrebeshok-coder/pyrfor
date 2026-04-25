// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runFreeClaudeWithCircuit } from './pyrfor-fc-circuit-router';
import type { FcCircuitRouterOptions, CircuitRoutedResult } from './pyrfor-fc-circuit-router';
import type { FCHandle, FCEnvelope, FCRunResult } from './pyrfor-fc-adapter';
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
