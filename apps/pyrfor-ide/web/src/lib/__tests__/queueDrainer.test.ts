import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks (must be hoisted before module imports) ───────────────────────────

// We need to mock offlineQueue before queueDrainer imports it.
vi.mock('../offlineQueue', () => {
  const items: Array<{ id: string; ts: number; kind: string; payload: unknown }> = [];
  return {
    list: vi.fn(() => [...items]),
    remove: vi.fn((id: string) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx !== -1) items.splice(idx, 1);
    }),
    _items: items,
    _push: (item: (typeof items)[0]) => items.push(item),
    _clear: () => items.splice(0),
  };
});

vi.mock('../apiFetch', () => {
  const target = new EventTarget();
  return {
    apiEvents: target,
    _fire: (event: string) => target.dispatchEvent(new CustomEvent(event)),
  };
});

// ─── Now import the modules under test ───────────────────────────────────────

import { setDrainHandler, drainNow } from '../queueDrainer';
import * as offlineQueueMock from '../offlineQueue';
import * as apiFetchMock from '../apiFetch';

// Typed helpers to avoid TS complaints about the extra test-only exports.
const oq = offlineQueueMock as unknown as {
  list: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  _items: Array<{ id: string; ts: number; kind: string; payload: unknown }>;
  _push: (item: { id: string; ts: number; kind: string; payload: unknown }) => void;
  _clear: () => void;
};
const apiFire = (apiFetchMock as unknown as { _fire: (e: string) => void })._fire;

function makeItem(id: string, text = 'hello') {
  return { id, ts: Date.now(), kind: 'text' as const, payload: { text } };
}

beforeEach(() => {
  oq._clear();
  vi.clearAllMocks();
  // Reset drain handler between tests.
  setDrainHandler(null);
});

afterEach(() => {
  setDrainHandler(null);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('queueDrainer', () => {
  it('drainNow does nothing when no handler is set', async () => {
    oq._push(makeItem('i1'));
    await drainNow();
    expect(oq.remove).not.toHaveBeenCalled();
  });

  it('drainNow drains all items when handler succeeds', async () => {
    oq._push(makeItem('i1'));
    oq._push(makeItem('i2'));

    const handler = vi.fn().mockResolvedValue(undefined);
    setDrainHandler(handler);

    await drainNow();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(oq.remove).toHaveBeenCalledWith('i1');
    expect(oq.remove).toHaveBeenCalledWith('i2');
  });

  it('stops draining and leaves remaining items on first failure', async () => {
    oq._push(makeItem('i1'));
    oq._push(makeItem('i2'));
    oq._push(makeItem('i3'));

    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);

    setDrainHandler(handler);

    await drainNow();

    // Handler called once (the failing item), not for the rest.
    expect(handler).toHaveBeenCalledTimes(1);
    // No items should have been removed.
    expect(oq.remove).not.toHaveBeenCalled();
  });

  it('removes only successfully sent items and stops on failure mid-queue', async () => {
    oq._push(makeItem('i1'));
    oq._push(makeItem('i2'));
    oq._push(makeItem('i3'));

    const handler = vi.fn()
      .mockResolvedValueOnce(undefined) // i1 succeeds
      .mockRejectedValueOnce(new Error('fail')) // i2 fails
      .mockResolvedValue(undefined); // i3 never reached

    setDrainHandler(handler);

    // We need list() to reflect removal. Simulate the side-effect of remove.
    oq.remove.mockImplementation((id: string) => {
      const idx = oq._items.findIndex((i) => i.id === id);
      if (idx !== -1) oq._items.splice(idx, 1);
    });

    await drainNow();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(oq.remove).toHaveBeenCalledWith('i1');
    expect(oq.remove).not.toHaveBeenCalledWith('i2');
    expect(oq.remove).not.toHaveBeenCalledWith('i3');
  });

  it('drains on apiEvents "recovered" event', async () => {
    oq._push(makeItem('i1'));

    const handler = vi.fn().mockResolvedValue(undefined);
    setDrainHandler(handler);

    apiFire('recovered');

    // Allow microtasks to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('prevents re-entrant draining', async () => {
    oq._push(makeItem('i1'));

    let resolveDrain: (() => void) | null = null;
    const handler = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveDrain = resolve; }),
    );
    setDrainHandler(handler);

    // Start a drain that won't finish yet.
    const drain1 = drainNow();
    // Second call should be a no-op (re-entrancy guard).
    const drain2 = drainNow();

    resolveDrain!();
    await drain1;
    await drain2;

    // handler must only be called once even though drainNow was called twice.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows a second drain after the first completes', async () => {
    oq._push(makeItem('i1'));

    const handler = vi.fn().mockResolvedValue(undefined);
    setDrainHandler(handler);

    await drainNow();
    oq._push(makeItem('i2'));
    await drainNow();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
