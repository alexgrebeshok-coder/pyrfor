// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createToolRouter,
  builtinValidate,
  type ToolRouter,
  type ToolRouterOptions,
  type DispatchResult,
} from './tool-router';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRouter(extra?: Partial<ToolRouterOptions>): ToolRouter {
  return createToolRouter({ defaultTimeoutMs: 30_000, ...extra });
}

function echoTool(overrides?: object) {
  return {
    name: 'echo',
    description: 'Returns args',
    parameters: {
      type: 'object' as const,
      properties: { message: { type: 'string' as const } },
      required: ['message'],
    },
    handler: async (args: Record<string, unknown>) => args['message'],
    ...overrides,
  };
}

// ── 1. Register + dispatch happy path ────────────────────────────────────────

describe('register + dispatch happy path', () => {
  it('dispatches a registered tool and returns ok:true', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 'hello' } });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('attempts is 1 on first success', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 'hi' } });
    expect(result.attempts).toBe(1);
  });

  it('durationMs is >= 0', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 'hi' } });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── 2. tool_not_found ────────────────────────────────────────────────────────

describe('unknown tool', () => {
  it('returns error type tool_not_found', async () => {
    const router = makeRouter();
    const result = await router.dispatch({ name: 'nonexistent', args: {} });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('tool_not_found');
  });

  it('includes tool name in message', async () => {
    const router = makeRouter();
    const result = await router.dispatch({ name: 'missing_tool', args: {} });
    expect(result.error?.message).toContain('missing_tool');
  });
});

// ── 3. invalid_args ──────────────────────────────────────────────────────────

describe('invalid args', () => {
  it('returns error type invalid_args when required field missing', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: {} });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('invalid_args');
  });

  it('returns error when type mismatch', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 42 } });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('invalid_args');
  });

  it('returns error for enum violation', async () => {
    const router = makeRouter();
    router.register({
      name: 'status',
      description: 'Set status',
      parameters: {
        type: 'object',
        properties: { level: { type: 'string', enum: ['low', 'high'] } },
        required: ['level'],
      },
      handler: async () => 'ok',
    });
    const result = await router.dispatch({ name: 'status', args: { level: 'medium' } });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('invalid_args');
  });
});

// ── 4. Timeout ────────────────────────────────────────────────────────────────

describe('timeout', () => {
  it('returns error type timeout when handler exceeds timeoutMs', async () => {
    let timerFn: (() => void) | undefined;
    const setTimer = (fn: () => void, _ms: number) => {
      timerFn = fn;
      return setTimeout(() => {}, 100_000); // never fires naturally
    };
    const clearTimer = (_id: ReturnType<typeof setTimeout>) => {};

    const router = createToolRouter({ defaultTimeoutMs: 10, setTimer, clearTimer });
    router.register({
      name: 'slow',
      description: 'never resolves',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: () => new Promise<never>(() => {}),
    });

    const promise = router.dispatch({ name: 'slow', args: {} });
    // trigger the timeout immediately
    timerFn?.();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('timeout');
  });
});

// ── 5. Retries succeed on 2nd attempt ────────────────────────────────────────

describe('retries', () => {
  it('retries on retryable error and succeeds on 2nd attempt', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'flaky',
      description: 'fails once',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        calls++;
        if (calls === 1) throw new Error('network error');
        return 'recovered';
      },
      options: { retries: 2 },
    });

    const result = await router.dispatch({ name: 'flaky', args: {} });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('recovered');
    expect(result.attempts).toBe(2);
  });

  it('exhausted retries returns last error', async () => {
    const router = makeRouter();
    router.register({
      name: 'always_fail',
      description: 'always fails',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        throw new Error('network error');
      },
      options: { retries: 2 },
    });

    const result = await router.dispatch({ name: 'always_fail', args: {} });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3); // 1 original + 2 retries
  });

  it('does NOT retry non-retryable errors', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'domain_error',
      description: 'throws domain error',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        calls++;
        throw new Error('validation failed');
      },
      options: { retries: 3 },
    });

    const result = await router.dispatch({ name: 'domain_error', args: {} });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1); // no retries
  });

  it('attempts counter is accurate across retries', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'tri',
      description: 'fails twice',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        calls++;
        if (calls < 3) throw new Error('timeout error');
        return 'done';
      },
      options: { retries: 5 },
    });

    const result = await router.dispatch({ name: 'tri', args: {} });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });
});

// ── 6. Idempotency ────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('de-dups concurrent identical calls', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'idem',
      description: 'idempotent op',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      handler: async (args: Record<string, unknown>) => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return `result-${args['id']}`;
      },
      options: { idempotent: true },
    });

    const [r1, r2] = await Promise.all([
      router.dispatch({ name: 'idem', args: { id: 'x' } }),
      router.dispatch({ name: 'idem', args: { id: 'x' } }),
    ]);

    expect(calls).toBe(1);
    expect(r1.value).toBe('result-x');
    expect(r2.value).toBe('result-x');
  });

  it('non-idempotent runs both calls independently', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'nonIdem',
      description: 'not idempotent',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      handler: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return calls;
      },
      options: { idempotent: false },
    });

    await Promise.all([
      router.dispatch({ name: 'nonIdem', args: { id: 'x' } }),
      router.dispatch({ name: 'nonIdem', args: { id: 'x' } }),
    ]);

    expect(calls).toBe(2);
  });

  it('different args are NOT de-duped even for idempotent tool', async () => {
    let calls = 0;
    const router = makeRouter();
    router.register({
      name: 'idem2',
      description: 'idempotent',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      handler: async () => {
        calls++;
        return calls;
      },
      options: { idempotent: true },
    });

    await Promise.all([
      router.dispatch({ name: 'idem2', args: { id: 'a' } }),
      router.dispatch({ name: 'idem2', args: { id: 'b' } }),
    ]);

    expect(calls).toBe(2);
  });
});

// ── 7. dispatchBatch ─────────────────────────────────────────────────────────

describe('dispatchBatch', () => {
  function makeCountRouter(delay = 0) {
    const order: number[] = [];
    const router = makeRouter();
    router.register({
      name: 'ordered',
      description: 'returns index',
      parameters: {
        type: 'object',
        properties: { i: { type: 'integer' } },
        required: ['i'],
      },
      handler: async (args: Record<string, unknown>) => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        order.push(args['i'] as number);
        return args['i'];
      },
    });
    return { router, order };
  }

  it('preserves order of results with parallel=true', async () => {
    const { router } = makeCountRouter();
    const calls = [0, 1, 2, 3, 4].map((i) => ({ name: 'ordered', args: { i } }));
    const results = await router.dispatchBatch(calls);
    expect(results.map((r) => r.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it('respects concurrency limit', async () => {
    // Use a slow handler and concurrency=2; all results still return ok
    const { router } = makeCountRouter(5);
    const calls = [0, 1, 2, 3].map((i) => ({ name: 'ordered', args: { i } }));
    const results = await router.dispatchBatch(calls, { concurrency: 2 });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('sequential mode (parallel=false) preserves order', async () => {
    const { router } = makeCountRouter();
    const calls = [0, 1, 2].map((i) => ({ name: 'ordered', args: { i } }));
    const results = await router.dispatchBatch(calls, { parallel: false });
    expect(results.map((r) => r.value)).toEqual([0, 1, 2]);
  });

  it('mixed success/error batch preserves positions', async () => {
    const router = makeRouter();
    router.register(echoTool());
    const calls = [
      { name: 'echo', args: { message: 'a' } },
      { name: 'ghost', args: {} }, // not registered
      { name: 'echo', args: { message: 'c' } },
    ];
    const results = await router.dispatchBatch(calls);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error?.type).toBe('tool_not_found');
    expect(results[2].ok).toBe(true);
  });
});

// ── 8. list / get / has / unregister ─────────────────────────────────────────

describe('registry operations', () => {
  it('list() returns all registered tools', () => {
    const router = makeRouter();
    router.register(echoTool());
    router.register({ ...echoTool(), name: 'echo2' });
    expect(router.list()).toHaveLength(2);
  });

  it('get() returns the definition', () => {
    const router = makeRouter();
    router.register(echoTool());
    expect(router.get('echo')?.name).toBe('echo');
  });

  it('get() returns undefined for unknown tool', () => {
    const router = makeRouter();
    expect(router.get('nope')).toBeUndefined();
  });

  it('has() returns true for registered tool', () => {
    const router = makeRouter();
    router.register(echoTool());
    expect(router.has('echo')).toBe(true);
  });

  it('has() returns false for unknown tool', () => {
    const router = makeRouter();
    expect(router.has('echo')).toBe(false);
  });

  it('unregister() removes a tool', () => {
    const router = makeRouter();
    router.register(echoTool());
    router.unregister('echo');
    expect(router.has('echo')).toBe(false);
  });

  it('dispatch returns tool_not_found after unregister', async () => {
    const router = makeRouter();
    router.register(echoTool());
    router.unregister('echo');
    const result = await router.dispatch({ name: 'echo', args: { message: 'hi' } });
    expect(result.error?.type).toBe('tool_not_found');
  });
});

// ── 9. describe() OpenAI shape ────────────────────────────────────────────────

describe('describe()', () => {
  it('returns OpenAI-style function-calling shape', () => {
    const router = makeRouter();
    router.register(echoTool());
    const [desc] = router.describe();
    expect(desc.type).toBe('function');
    expect(desc.function.name).toBe('echo');
    expect(desc.function.description).toBe('Returns args');
    expect(desc.function.parameters).toEqual(echoTool().parameters);
  });

  it('returns empty array when no tools registered', () => {
    const router = makeRouter();
    expect(router.describe()).toEqual([]);
  });

  it('includes all registered tools', () => {
    const router = makeRouter();
    router.register(echoTool());
    router.register({ ...echoTool(), name: 'echo2', description: 'Second' });
    expect(router.describe()).toHaveLength(2);
  });
});

// ── 10. Custom validator override ────────────────────────────────────────────

describe('custom validator', () => {
  it('uses custom validator instead of built-in', async () => {
    const customValidator = vi.fn(() => {
      // always pass
    });
    const router = createToolRouter({ validator: customValidator });
    router.register(echoTool());
    // args missing required 'message', but custom validator accepts it
    const result = await router.dispatch({ name: 'echo', args: {} });
    expect(customValidator).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true); // passes because handler returns undefined for missing key
  });

  it('custom validator can reject args', async () => {
    const router = createToolRouter({
      validator: () => {
        throw new Error('invalid_args:custom rejection');
      },
    });
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 'hi' } });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('invalid_args');
    expect(result.error?.message).toContain('custom rejection');
  });
});

// ── 11. onCall hook ───────────────────────────────────────────────────────────

describe('onCall hook', () => {
  it('receives name, args, and ctx', async () => {
    const received: unknown[] = [];
    const router = createToolRouter({
      onCall: (call) => received.push(call),
    });
    router.register(echoTool());
    const ctx = { userId: 'u1' };
    await router.dispatch({ name: 'echo', args: { message: 'test' }, ctx });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ name: 'echo', args: { message: 'test' }, ctx });
  });

  it('is NOT called for validation failures', async () => {
    const hook = vi.fn();
    const router = createToolRouter({ onCall: hook });
    router.register(echoTool());
    await router.dispatch({ name: 'echo', args: {} }); // missing required message
    expect(hook).not.toHaveBeenCalled();
  });

  it('is NOT called when tool not found', async () => {
    const hook = vi.fn();
    const router = createToolRouter({ onCall: hook });
    await router.dispatch({ name: 'ghost', args: {} });
    expect(hook).not.toHaveBeenCalled();
  });
});

// ── 12. durationMs > 0 ───────────────────────────────────────────────────────

describe('durationMs', () => {
  it('is greater than 0 for an async handler with delay', async () => {
    let t = 0;
    const clock = () => {
      t += 10;
      return t;
    };
    const router = createToolRouter({ clock });
    router.register(echoTool());
    const result = await router.dispatch({ name: 'echo', args: { message: 'x' } });
    expect(result.durationMs).toBeGreaterThan(0);
  });
});

// ── 13. dispatch rejects null/empty name ─────────────────────────────────────

describe('null / empty name', () => {
  it('returns error for empty string name', async () => {
    const router = makeRouter();
    const result = await router.dispatch({ name: '', args: {} });
    expect(result.ok).toBe(false);
  });

  it('returns tool_not_found for null-like name', async () => {
    const router = makeRouter();
    const result = await router.dispatch({ name: 'null', args: {} });
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('tool_not_found');
  });
});

// ── 14. register duplicate name throws ───────────────────────────────────────

describe('duplicate registration', () => {
  it('throws when registering a tool with the same name twice', () => {
    const router = makeRouter();
    router.register(echoTool());
    expect(() => router.register(echoTool())).toThrow();
  });

  it('allows re-register after unregister', () => {
    const router = makeRouter();
    router.register(echoTool());
    router.unregister('echo');
    expect(() => router.register(echoTool())).not.toThrow();
  });
});

// ── 15. tools passed in createToolRouter options ──────────────────────────────

describe('tools passed via options', () => {
  it('pre-registers tools from options', async () => {
    const router = createToolRouter({ tools: [echoTool()] });
    expect(router.has('echo')).toBe(true);
    const result = await router.dispatch({ name: 'echo', args: { message: 'preset' } });
    expect(result.ok).toBe(true);
  });
});

// ── 16. builtinValidate unit tests ───────────────────────────────────────────

describe('builtinValidate', () => {
  it('passes valid args', () => {
    expect(() =>
      builtinValidate(
        { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
        { x: 42 },
      ),
    ).not.toThrow();
  });

  it('throws on missing required key', () => {
    expect(() =>
      builtinValidate({ required: ['foo'] }, {}),
    ).toThrow(/invalid_args/);
  });

  it('throws on type mismatch', () => {
    expect(() =>
      builtinValidate(
        { properties: { n: { type: 'integer' } } },
        { n: 3.14 },
      ),
    ).toThrow(/invalid_args/);
  });

  it('accepts array type', () => {
    expect(() =>
      builtinValidate(
        { properties: { list: { type: 'array' } } },
        { list: [1, 2, 3] },
      ),
    ).not.toThrow();
  });

  it('accepts boolean type', () => {
    expect(() =>
      builtinValidate(
        { properties: { flag: { type: 'boolean' } } },
        { flag: true },
      ),
    ).not.toThrow();
  });
});
