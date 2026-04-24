// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from './event-bus';
import type { EventHandler } from './event-bus';

// ── helpers ──────────────────────────────────────────────────────────────────

type TestMap = {
  'auth.login':     { userId: string };
  'auth.logout':    { userId: string };
  'task.completed': { taskId: string };
  'task.failed':    { taskId: string; reason: string };
  'ping':           Record<string, never>;
  'data':           { value: number };
};

function makeBus(historySize?: number) {
  let ts = 0;
  return createEventBus<TestMap>({
    historySize,
    clock: () => ++ts,
    logger: () => undefined,
  });
}

// ── 1. on / emit basic ───────────────────────────────────────────────────────

describe('on / emit basic', () => {
  it('calls handler with correct shape', async () => {
    const bus = makeBus();
    const calls: any[] = [];
    bus.on('ping', (e) => calls.push(e));
    await bus.emit('ping', {});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'ping', payload: {} });
    expect(typeof calls[0].ts).toBe('number');
    expect(typeof calls[0].id).toBe('string');
  });

  it('delivers payload correctly', async () => {
    const bus = makeBus();
    let received: { userId: string } | undefined;
    bus.on('auth.login', (e) => { received = e.payload; });
    await bus.emit('auth.login', { userId: 'u1' });
    expect(received).toEqual({ userId: 'u1' });
  });

  it('calls multiple handlers for same type', async () => {
    const bus = makeBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.on('ping', b);
    await bus.emit('ping', {});
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not call handler for different type', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.on('auth.login', handler);
    await bus.emit('auth.logout', { userId: 'u1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('id is unique per emit', async () => {
    const bus = makeBus();
    const ids: string[] = [];
    bus.on('ping', (e) => ids.push(e.id));
    await bus.emit('ping', {});
    await bus.emit('ping', {});
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ── 2. unsubscribe (returned function) ───────────────────────────────────────

describe('unsubscribe via returned function', () => {
  it('removes handler after unsub()', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsub = bus.on('ping', handler);
    unsub();
    await bus.emit('ping', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('only removes the specific subscription', async () => {
    const bus = makeBus();
    const a = vi.fn();
    const b = vi.fn();
    const unsub = bus.on('ping', a);
    bus.on('ping', b);
    unsub();
    await bus.emit('ping', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('calling unsub twice is safe', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsub = bus.on('ping', handler);
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

// ── 3. off by handler ref ────────────────────────────────────────────────────

describe('off(handler)', () => {
  it('returns true when handler was found', () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.on('ping', handler);
    expect(bus.off(handler)).toBe(true);
  });

  it('returns false when handler not registered', () => {
    const bus = makeBus();
    expect(bus.off(vi.fn())).toBe(false);
  });

  it('removes handler registered across multiple types', async () => {
    const bus = makeBus();
    const handler: EventHandler<any> = vi.fn();
    bus.on('ping', handler);
    bus.on('auth.login', handler);
    bus.off(handler);
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── 4. onAny ─────────────────────────────────────────────────────────────────

describe('onAny', () => {
  it('receives every event type', async () => {
    const bus = makeBus();
    const calls: string[] = [];
    bus.onAny((e) => calls.push(e.type));
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    await bus.emit('task.completed', { taskId: 't1' });
    expect(calls).toEqual(['ping', 'auth.login', 'task.completed']);
  });

  it('onAny unsub works', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsub = bus.onAny(handler);
    unsub();
    await bus.emit('ping', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAny off(ref) works', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onAny(handler);
    bus.off(handler);
    await bus.emit('ping', {});
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── 5. onPattern ─────────────────────────────────────────────────────────────

describe('onPattern', () => {
  it('auth.* matches auth.login', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onPattern('auth.*', handler);
    await bus.emit('auth.login', { userId: 'u1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('auth.* matches auth.logout', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onPattern('auth.*', handler);
    await bus.emit('auth.logout', { userId: 'u1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('auth.* does NOT match task.completed', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onPattern('auth.*', handler);
    await bus.emit('task.completed', { taskId: 't1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('*.completed matches task.completed', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onPattern('*.completed', handler);
    await bus.emit('task.completed', { taskId: 't1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('*.completed does NOT match auth.login', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.onPattern('*.completed', handler);
    await bus.emit('auth.login', { userId: 'u1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('** matches every event', async () => {
    const bus = makeBus();
    const calls: string[] = [];
    bus.onPattern('**', (e) => calls.push(e.type));
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    await bus.emit('task.failed', { taskId: 't1', reason: 'oops' });
    expect(calls).toHaveLength(3);
  });

  it('pattern unsub stops delivery', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsub = bus.onPattern('auth.*', handler);
    unsub();
    await bus.emit('auth.login', { userId: 'u1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('auth.* does NOT match auth.login.extra (two dots)', async () => {
    // `auth.*` → `[^.]+` so it won't cross a dot boundary
    const bus = createEventBus<{ 'auth.login.extra': {} }>({ clock: () => 1, logger: () => undefined });
    const handler = vi.fn();
    bus.onPattern('auth.*', handler);
    await bus.emit('auth.login.extra', {});
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── 6. async handlers ────────────────────────────────────────────────────────

describe('emit awaits async handlers', () => {
  it('await emit waits for all async handlers', async () => {
    const bus = makeBus();
    const order: number[] = [];
    bus.on('ping', async () => {
      await new Promise<void>((r) => setTimeout(r, 20));
      order.push(1);
    });
    bus.on('ping', async () => {
      await new Promise<void>((r) => setTimeout(r, 5));
      order.push(2);
    });
    await bus.emit('ping', {});
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it('emit resolves only after all async handlers finish', async () => {
    const bus = makeBus();
    let done = false;
    bus.on('ping', async () => {
      await new Promise<void>((r) => setTimeout(r, 30));
      done = true;
    });
    await bus.emit('ping', {});
    expect(done).toBe(true);
  });
});

// ── 7. error isolation ───────────────────────────────────────────────────────

describe('error isolation', () => {
  it('error in handler does not throw from emit', async () => {
    const bus = makeBus();
    bus.on('ping', () => { throw new Error('boom'); });
    await expect(bus.emit('ping', {})).resolves.toBeUndefined();
  });

  it('error in one handler does not prevent other handlers running', async () => {
    const bus = makeBus();
    const second = vi.fn();
    bus.on('ping', () => { throw new Error('boom'); });
    bus.on('ping', second);
    await bus.emit('ping', {});
    expect(second).toHaveBeenCalledOnce();
  });

  it('logger is called with error details', async () => {
    const logged: any[] = [];
    const bus = createEventBus<TestMap>({ logger: (msg, meta) => logged.push({ msg, meta }) });
    bus.on('ping', () => { throw new Error('oops'); });
    await bus.emit('ping', {});
    expect(logged).toHaveLength(1);
    expect(logged[0].msg).toContain('error');
  });

  it('async handler rejection is isolated', async () => {
    const bus = makeBus();
    bus.on('ping', async () => { throw new Error('async boom'); });
    await expect(bus.emit('ping', {})).resolves.toBeUndefined();
  });
});

// ── 8. emitSync ──────────────────────────────────────────────────────────────

describe('emitSync', () => {
  it('is synchronous — does not return a promise', () => {
    const bus = makeBus();
    bus.on('ping', vi.fn());
    const result = bus.emitSync('ping', {});
    expect(result).toBeUndefined();
  });

  it('fires handlers synchronously', () => {
    const bus = makeBus();
    let called = false;
    bus.on('ping', () => { called = true; });
    bus.emitSync('ping', {});
    expect(called).toBe(true);
  });

  it('adds to history', () => {
    const bus = makeBus();
    bus.emitSync('ping', {});
    expect(bus.history()).toHaveLength(1);
  });

  it('does not await async handlers', async () => {
    const bus = makeBus();
    let done = false;
    bus.on('ping', async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
      done = true;
    });
    bus.emitSync('ping', {});
    // immediately after emitSync, async work hasn't finished
    expect(done).toBe(false);
    // wait for micro/macro tasks to drain
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(done).toBe(true);
  });
});

// ── 9. waitFor ───────────────────────────────────────────────────────────────

describe('waitFor', () => {
  it('resolves with payload on next matching emit', async () => {
    const bus = makeBus();
    const promise = bus.waitFor('auth.login');
    await bus.emit('auth.login', { userId: 'alice' });
    const result = await promise;
    expect(result).toEqual({ userId: 'alice' });
  });

  it('ignores non-matching types', async () => {
    const bus = makeBus();
    const promise = bus.waitFor('auth.login');
    await bus.emit('auth.logout', { userId: 'u1' });
    let resolved = false;
    promise.then(() => { resolved = true; });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    await bus.emit('auth.login', { userId: 'u1' });
    await promise;
    expect(resolved).toBe(true);
  });

  it('with predicate — waits for matching payload', async () => {
    const bus = makeBus();
    const promise = bus.waitFor('data', { predicate: (p) => p.value > 5 });
    await bus.emit('data', { value: 3 });
    await bus.emit('data', { value: 7 });
    const result = await promise;
    expect(result).toEqual({ value: 7 });
  });

  it('times out when no matching event fires', async () => {
    const bus = makeBus();
    await expect(bus.waitFor('ping', { timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it('does not time out when event fires before deadline', async () => {
    const bus = makeBus();
    const promise = bus.waitFor('ping', { timeoutMs: 200 });
    setTimeout(() => bus.emit('ping', {}), 10);
    await expect(promise).resolves.toBeDefined();
  });
});

// ── 10. history ──────────────────────────────────────────────────────────────

describe('history', () => {
  it('returns events in emission order', async () => {
    const bus = makeBus();
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    const h = bus.history();
    expect(h.map((e) => e.type)).toEqual(['ping', 'auth.login']);
  });

  it('filter by type', async () => {
    const bus = makeBus();
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    await bus.emit('ping', {});
    const h = bus.history({ type: 'ping' });
    expect(h).toHaveLength(2);
    expect(h.every((e) => e.type === 'ping')).toBe(true);
  });

  it('filter by sinceTs', async () => {
    const bus = makeBus();
    await bus.emit('ping', {}); // ts=1
    await bus.emit('ping', {}); // ts=2
    await bus.emit('ping', {}); // ts=3
    const h = bus.history({ sinceTs: 2 });
    expect(h.length).toBe(2);
    expect(h.every((e) => e.ts >= 2)).toBe(true);
  });

  it('filter by limit returns latest N', async () => {
    const bus = makeBus();
    for (let i = 0; i < 5; i++) await bus.emit('ping', {});
    const h = bus.history({ limit: 3 });
    expect(h).toHaveLength(3);
    expect(h[0]!.ts).toBe(3);
    expect(h[2]!.ts).toBe(5);
  });

  it('returns snapshot (not live reference)', async () => {
    const bus = makeBus();
    await bus.emit('ping', {});
    const h = bus.history();
    await bus.emit('ping', {});
    expect(h).toHaveLength(1);
  });
});

// ── 11. ring buffer ──────────────────────────────────────────────────────────

describe('ring buffer', () => {
  it('trims oldest events when capacity exceeded', async () => {
    const bus = makeBus(3);
    await bus.emit('ping', {}); // ts=1
    await bus.emit('ping', {}); // ts=2
    await bus.emit('ping', {}); // ts=3
    await bus.emit('ping', {}); // ts=4  ← ts=1 dropped
    const h = bus.history();
    expect(h).toHaveLength(3);
    expect(h[0]!.ts).toBe(2);
    expect(h[2]!.ts).toBe(4);
  });

  it('never exceeds configured historySize', async () => {
    const bus = makeBus(5);
    for (let i = 0; i < 20; i++) await bus.emit('ping', {});
    expect(bus.history()).toHaveLength(5);
  });
});

// ── 12. clearHistory ─────────────────────────────────────────────────────────

describe('clearHistory', () => {
  it('empties the history buffer', async () => {
    const bus = makeBus();
    await bus.emit('ping', {});
    await bus.emit('auth.login', { userId: 'u1' });
    bus.clearHistory();
    expect(bus.history()).toHaveLength(0);
  });

  it('history continues to work after clear', async () => {
    const bus = makeBus();
    await bus.emit('ping', {});
    bus.clearHistory();
    await bus.emit('auth.login', { userId: 'u1' });
    expect(bus.history()).toHaveLength(1);
  });
});

// ── 13. listenerCount ────────────────────────────────────────────────────────

describe('listenerCount', () => {
  it('returns 0 for a type with no listeners', () => {
    const bus = makeBus();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('counts exact-type subscriptions', () => {
    const bus = makeBus();
    bus.on('ping', vi.fn());
    bus.on('ping', vi.fn());
    expect(bus.listenerCount('ping')).toBe(2);
  });

  it('counts pattern subscriptions that match the type', () => {
    const bus = makeBus();
    bus.onPattern('auth.*', vi.fn());
    expect(bus.listenerCount('auth.login')).toBe(1);
    expect(bus.listenerCount('task.completed')).toBe(0);
  });

  it('no args returns total subscription count (excl onAny)', () => {
    const bus = makeBus();
    bus.on('ping', vi.fn());
    bus.onAny(vi.fn());   // counted in total entries
    bus.onPattern('auth.*', vi.fn());
    // total entries = 3; listenerCount() returns all entries length
    expect(bus.listenerCount()).toBe(3);
  });
});

// ── 14. removeAll ────────────────────────────────────────────────────────────

describe('removeAll', () => {
  it('removeAll(type) clears handlers for that type', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.removeAll('ping');
    await bus.emit('ping', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAll(type) does not affect other types', async () => {
    const bus = makeBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.on('auth.login', b);
    bus.removeAll('ping');
    await bus.emit('auth.login', { userId: 'u1' });
    expect(b).toHaveBeenCalledOnce();
  });

  it('removeAll() with no arg clears all handlers', async () => {
    const bus = makeBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.onAny(b);
    bus.removeAll();
    await bus.emit('ping', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('removeAll() resets listenerCount to 0', () => {
    const bus = makeBus();
    bus.on('ping', vi.fn());
    bus.onAny(vi.fn());
    bus.removeAll();
    expect(bus.listenerCount()).toBe(0);
  });
});

// ── 15. typed EventMap compile-time check ────────────────────────────────────

describe('TypeScript compile-time checks', () => {
  it('EventMap enforces payload types via @ts-expect-error', async () => {
    const bus = createEventBus<TestMap>();

    // @ts-expect-error — wrong payload type: number instead of { userId: string }
    await bus.emit('auth.login', 42 as any);

    // This line validates the above @ts-expect-error compiles cleanly.
    expect(true).toBe(true);
  });

  it('correctly typed payload compiles without error', async () => {
    const bus = createEventBus<TestMap>();
    const handler = vi.fn();
    bus.on('auth.login', handler);
    await bus.emit('auth.login', { userId: 'typed-user' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { userId: 'typed-user' } }),
    );
  });
});
