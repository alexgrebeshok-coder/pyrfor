// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJsonRpcServer } from './json-rpc-server';
import type { JsonRpcResponse } from './json-rpc-server';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeServer(opts?: Parameters<typeof createJsonRpcServer>[0]) {
  return createJsonRpcServer(opts);
}

function asObj(res: string | null): JsonRpcResponse {
  expect(res).not.toBeNull();
  return JSON.parse(res!) as JsonRpcResponse;
}

// ── register / unregister ────────────────────────────────────────────────────

describe('register / unregister', () => {
  it('registers a method and returns it in getRegisteredMethods', () => {
    const srv = makeServer();
    srv.register('add', () => 1);
    expect(srv.getRegisteredMethods()).toContain('add');
  });

  it('register returns a deregister function that removes the method', () => {
    const srv = makeServer();
    const deregister = srv.register('add', () => 1);
    deregister();
    expect(srv.getRegisteredMethods()).not.toContain('add');
  });

  it('unregister returns true when method exists', () => {
    const srv = makeServer();
    srv.register('add', () => 1);
    expect(srv.unregister('add')).toBe(true);
  });

  it('unregister returns false when method does not exist', () => {
    const srv = makeServer();
    expect(srv.unregister('nonexistent')).toBe(false);
  });

  it('can register multiple methods', () => {
    const srv = makeServer();
    srv.register('a', () => 1);
    srv.register('b', () => 2);
    expect(srv.getRegisteredMethods()).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

// ── valid request → result ────────────────────────────────────────────────────

describe('valid request', () => {
  it('returns result for a synchronous handler', async () => {
    const srv = makeServer();
    srv.register('echo', (params) => params);
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"echo","params":"hello","id":1}'));
    expect(res.result).toBe('hello');
    expect(res.id).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it('returns result for an async handler', async () => {
    const srv = makeServer();
    srv.register('asyncMethod', async () => 42);
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"asyncMethod","id":2}'));
    expect(res.result).toBe(42);
  });

  it('preserves string ids', async () => {
    const srv = makeServer();
    srv.register('ping', () => 'pong');
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"ping","id":"abc"}'));
    expect(res.id).toBe('abc');
  });

  it('preserves number ids', async () => {
    const srv = makeServer();
    srv.register('ping', () => 'pong');
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"ping","id":99}'));
    expect(res.id).toBe(99);
  });

  it('passes params to handler', async () => {
    const srv = makeServer();
    const handler = vi.fn().mockReturnValue('ok');
    srv.register('m', handler);
    await srv.handle('{"jsonrpc":"2.0","method":"m","params":{"x":1},"id":1}');
    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ id: 1 }));
  });

  it('passes ctx.id to handler', async () => {
    const srv = makeServer();
    let capturedId: unknown;
    srv.register('m', (_p, ctx) => { capturedId = ctx.id; return null; });
    await srv.handle('{"jsonrpc":"2.0","method":"m","id":"req-1"}');
    expect(capturedId).toBe('req-1');
  });
});

// ── error responses ───────────────────────────────────────────────────────────

describe('method not found', () => {
  it('returns -32601 when method is not registered', async () => {
    const srv = makeServer();
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"missing","id":1}'));
    expect(res.error?.code).toBe(-32601);
    expect(res.id).toBe(1);
  });
});

describe('parse error', () => {
  it('returns -32700 with id null on invalid JSON', async () => {
    const srv = makeServer();
    const res = asObj(await srv.handle('{bad json'));
    expect(res.error?.code).toBe(-32700);
    expect(res.id).toBeNull();
  });
});

describe('invalid request', () => {
  it('returns -32600 for wrong jsonrpc version', async () => {
    const srv = makeServer();
    const res = asObj(await srv.handle('{"jsonrpc":"1.0","method":"x","id":1}'));
    expect(res.error?.code).toBe(-32600);
  });

  it('returns -32600 when method field is missing', async () => {
    const srv = makeServer();
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","id":1}'));
    expect(res.error?.code).toBe(-32600);
  });

  it('returns -32600 for empty batch array', async () => {
    const srv = makeServer();
    const res = asObj(await srv.handle('[]'));
    expect(res.error?.code).toBe(-32600);
  });

  it('returns -32600 when batch exceeds maxBatchSize', async () => {
    const srv = makeServer({ maxBatchSize: 2 });
    srv.register('m', () => 1);
    const batch = JSON.stringify([
      { jsonrpc: '2.0', method: 'm', id: 1 },
      { jsonrpc: '2.0', method: 'm', id: 2 },
      { jsonrpc: '2.0', method: 'm', id: 3 },
    ]);
    const res = asObj(await srv.handle(batch));
    expect(res.error?.code).toBe(-32600);
  });
});

// ── notifications ─────────────────────────────────────────────────────────────

describe('notifications', () => {
  it('returns null (no response) for a notification', async () => {
    const srv = makeServer();
    srv.register('notify', () => 'ignored');
    const res = await srv.handle('{"jsonrpc":"2.0","method":"notify"}');
    expect(res).toBeNull();
  });

  it('still executes the handler for a notification', async () => {
    const srv = makeServer();
    const fn = vi.fn();
    srv.register('notify', fn);
    await srv.handle('{"jsonrpc":"2.0","method":"notify"}');
    expect(fn).toHaveBeenCalled();
  });
});

// ── batch ─────────────────────────────────────────────────────────────────────

describe('batch', () => {
  it('returns array of responses for batch request', async () => {
    const srv = makeServer();
    srv.register('add', (p) => (p as { a: number; b: number }).a + (p as { a: number; b: number }).b);
    const raw = await srv.handle(JSON.stringify([
      { jsonrpc: '2.0', method: 'add', params: { a: 1, b: 2 }, id: 1 },
      { jsonrpc: '2.0', method: 'add', params: { a: 3, b: 4 }, id: 2 },
    ]));
    const res = JSON.parse(raw!) as JsonRpcResponse[];
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(2);
    expect(res[0].result).toBe(3);
    expect(res[1].result).toBe(7);
  });

  it('omits notifications from batch response', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const raw = await srv.handle(JSON.stringify([
      { jsonrpc: '2.0', method: 'm', id: 1 },
      { jsonrpc: '2.0', method: 'm' }, // notification
    ]));
    const res = JSON.parse(raw!) as JsonRpcResponse[];
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(1);
  });

  it('returns null when batch is all notifications', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const res = await srv.handle(JSON.stringify([
      { jsonrpc: '2.0', method: 'm' },
      { jsonrpc: '2.0', method: 'm' },
    ]));
    expect(res).toBeNull();
  });
});

// ── handler errors ────────────────────────────────────────────────────────────

describe('handler errors', () => {
  it('returns -32603 with error message when handler throws Error', async () => {
    const srv = makeServer();
    srv.register('boom', () => { throw new Error('exploded'); });
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"boom","id":1}'));
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toBe('exploded');
  });

  it('preserves { code, message, data } when handler throws RPC-shaped error', async () => {
    const srv = makeServer();
    srv.register('custom', () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { code: -32602, message: 'bad params', data: { field: 'x' } };
    });
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"custom","id":1}'));
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toBe('bad params');
    expect(res.error?.data).toEqual({ field: 'x' });
  });
});

// ── timeout ───────────────────────────────────────────────────────────────────

describe('timeout', () => {
  it('returns -32603 "Method timeout" when handler exceeds defaultTimeoutMs', async () => {
    let triggerTimeout!: () => void;
    const setTimer = vi.fn((_cb: () => void, _ms: number): unknown => {
      triggerTimeout = _cb;
      return 42;
    });
    const clearTimer = vi.fn();

    const srv = makeServer({ defaultTimeoutMs: 100, setTimer, clearTimer });
    srv.register('slow', () => new Promise(() => { /* never resolves */ }));

    const pending = srv.handle('{"jsonrpc":"2.0","method":"slow","id":1}');
    // Fire the timeout synchronously
    triggerTimeout();
    const res = asObj(await pending);
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toBe('Method timeout');
  });

  it('aborts the AbortSignal on timeout', async () => {
    let triggerTimeout!: () => void;
    const setTimer = vi.fn((_cb: () => void, _ms: number): unknown => {
      triggerTimeout = _cb;
      return 1;
    });
    const clearTimer = vi.fn();

    const srv = makeServer({ defaultTimeoutMs: 50, setTimer, clearTimer });

    let capturedSignal: AbortSignal | undefined;
    srv.register('slow', (_p, ctx) => {
      capturedSignal = ctx.signal;
      return new Promise(() => { /* never */ });
    });

    const pending = srv.handle('{"jsonrpc":"2.0","method":"slow","id":1}');
    triggerTimeout();
    await pending;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('clears the timer on successful completion', async () => {
    const clearTimer = vi.fn();
    const setTimer = vi.fn((_cb: () => void, _ms: number): unknown => 99);

    const srv = makeServer({ defaultTimeoutMs: 5000, setTimer, clearTimer });
    srv.register('fast', () => 'done');
    await srv.handle('{"jsonrpc":"2.0","method":"fast","id":1}');
    expect(clearTimer).toHaveBeenCalledWith(99);
  });
});

// ── stats ─────────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('tracks total calls', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    await srv.handle('{"jsonrpc":"2.0","method":"m","id":1}');
    await srv.handle('{"jsonrpc":"2.0","method":"m","id":2}');
    expect(srv.getStats().calls).toBe(2);
  });

  it('tracks total errors', async () => {
    const srv = makeServer();
    srv.register('boom', () => { throw new Error('err'); });
    await srv.handle('{"jsonrpc":"2.0","method":"boom","id":1}');
    expect(srv.getStats().errors).toBe(1);
  });

  it('tracks perMethod calls and errors', async () => {
    const srv = makeServer();
    srv.register('ok', () => 1);
    srv.register('fail', () => { throw new Error('x'); });
    await srv.handle('{"jsonrpc":"2.0","method":"ok","id":1}');
    await srv.handle('{"jsonrpc":"2.0","method":"fail","id":2}');
    const s = srv.getStats();
    expect(s.perMethod['ok'].calls).toBe(1);
    expect(s.perMethod['ok'].errors).toBe(0);
    expect(s.perMethod['fail'].calls).toBe(1);
    expect(s.perMethod['fail'].errors).toBe(1);
  });

  it('tracks totalMs per method using injected clock', async () => {
    let t = 0;
    const clock = vi.fn(() => t);
    const srv = makeServer({ clock });
    srv.register('m', () => { t = 50; return 1; });
    t = 0;
    await srv.handle('{"jsonrpc":"2.0","method":"m","id":1}');
    expect(srv.getStats().perMethod['m'].totalMs).toBe(50);
  });
});

// ── onError callback ──────────────────────────────────────────────────────────

describe('onError', () => {
  it('calls onError when handler throws Error', async () => {
    const onError = vi.fn();
    const srv = makeServer({ onError });
    srv.register('boom', () => { throw new Error('fail'); });
    await srv.handle('{"jsonrpc":"2.0","method":"boom","id":1}');
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── handle vs handleObject ────────────────────────────────────────────────────

describe('handle vs handleObject', () => {
  it('handle returns JSON string', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const res = await srv.handle('{"jsonrpc":"2.0","method":"m","id":1}');
    expect(typeof res).toBe('string');
    expect(JSON.parse(res!)).toMatchObject({ result: 1 });
  });

  it('handleObject returns object, not string', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const res = await srv.handleObject({ jsonrpc: '2.0', method: 'm', id: 1 });
    expect(typeof res).toBe('object');
    expect((res as JsonRpcResponse).result).toBe(1);
  });

  it('handleObject returns array for batch', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const res = await srv.handleObject([
      { jsonrpc: '2.0', method: 'm', id: 1 },
      { jsonrpc: '2.0', method: 'm', id: 2 },
    ]);
    expect(Array.isArray(res)).toBe(true);
    expect((res as JsonRpcResponse[]).length).toBe(2);
  });

  it('handle accepts object directly (not just string)', async () => {
    const srv = makeServer();
    srv.register('m', () => 99);
    const res = await srv.handle({ jsonrpc: '2.0', method: 'm', id: 5 });
    expect(JSON.parse(res!)).toMatchObject({ result: 99, id: 5 });
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('method not found for notification produces no response', async () => {
    const srv = makeServer();
    const res = await srv.handle('{"jsonrpc":"2.0","method":"ghost"}');
    expect(res).toBeNull();
  });

  it('null id in request is preserved in response', async () => {
    const srv = makeServer();
    srv.register('m', () => 1);
    const res = asObj(await srv.handle('{"jsonrpc":"2.0","method":"m","id":null}'));
    expect(res.id).toBeNull();
  });

  it('registers and immediately deregisters via returned function', () => {
    const srv = makeServer();
    const dereg = srv.register('temp', () => 1);
    expect(srv.getRegisteredMethods()).toContain('temp');
    dereg();
    expect(srv.getRegisteredMethods()).not.toContain('temp');
  });
});
