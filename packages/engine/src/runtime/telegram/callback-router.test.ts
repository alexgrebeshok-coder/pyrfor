import { describe, it, expect, vi } from 'vitest';
import { createCallbackRouter } from './callback-router';

describe('createCallbackRouter', () => {
  it('returns an object with on and dispatch methods', () => {
    const router = createCallbackRouter();
    expect(typeof router.on).toBe('function');
    expect(typeof router.dispatch).toBe('function');
  });

  it('dispatches to a registered handler with correct action', async () => {
    const router = createCallbackRouter();
    const handler = vi.fn();
    router.on('status', handler);

    const ctx = { fake: 'ctx' };
    const result = await router.dispatch('status:refresh', ctx);

    expect(result).toEqual({ handled: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('refresh', ctx);
  });

  it('returns { handled: false } for unknown namespace', async () => {
    const router = createCallbackRouter();
    router.on('status', vi.fn());

    const result = await router.dispatch('unknown:action', {});
    expect(result).toEqual({ handled: false });
  });

  it('returns { handled: false } for malformed callback data', async () => {
    const router = createCallbackRouter();

    expect(await router.dispatch('', {})).toEqual({ handled: false });
    expect(await router.dispatch('nocolon', {})).toEqual({ handled: false });
    expect(await router.dispatch(':emptyns', {})).toEqual({ handled: false });
    expect(await router.dispatch('emptyaction:', {})).toEqual({ handled: false });
  });

  it('awaits async handlers before returning', async () => {
    const router = createCallbackRouter();
    const order: number[] = [];

    router.on('async', async (_action, _ctx) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      order.push(1);
    });

    const resultPromise = router.dispatch('async:go', {});
    order.push(0); // this runs before the promise resolves
    await resultPromise;
    order.push(2);

    // 0 is pushed before await resolves, 1 inside handler, 2 after dispatch
    expect(order).toEqual([0, 1, 2]);
  });

  it('passes the full ctx object to the handler unchanged', async () => {
    const router = createCallbackRouter();
    let receivedCtx: unknown;

    router.on('ctx', (action, ctx) => {
      receivedCtx = ctx;
    });

    const ctx = { chatId: 42, data: 'hello' };
    await router.dispatch('ctx:test', ctx);
    expect(receivedCtx).toBe(ctx);
  });

  it('supports multiple namespaces independently', async () => {
    const router = createCallbackRouter();
    const aHandler = vi.fn();
    const bHandler = vi.fn();

    router.on('a', aHandler);
    router.on('b', bHandler);

    await router.dispatch('a:go', {});
    expect(aHandler).toHaveBeenCalledOnce();
    expect(bHandler).not.toHaveBeenCalled();

    await router.dispatch('b:stop', {});
    expect(bHandler).toHaveBeenCalledOnce();
  });

  it('later on() call overwrites earlier registration for same namespace', async () => {
    const router = createCallbackRouter();
    const first = vi.fn();
    const second = vi.fn();

    router.on('ns', first);
    router.on('ns', second);

    await router.dispatch('ns:x', {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
