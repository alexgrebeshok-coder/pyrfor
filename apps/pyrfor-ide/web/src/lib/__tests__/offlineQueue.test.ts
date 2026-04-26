import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── localStorage mock ───────────────────────────────────────────────────────

let store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { store = {}; },
};

vi.stubGlobal('localStorage', localStorageMock);
// BroadcastChannel is not available in jsdom; ensure it's undefined so the
// module falls back to the storage-event path.
vi.stubGlobal('BroadcastChannel', undefined);

// Import after globals are stubbed so module-level code sees the mocks.
import {
  enqueue,
  list,
  remove,
  clear,
  onChange,
  type QueuedItem,
} from '../offlineQueue';

const STORAGE_KEY = 'pyrfor.offline.chat.queue.v1';

beforeEach(() => {
  store = {};
});

afterEach(() => {
  clear();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offlineQueue', () => {
  it('enqueue returns an id string', () => {
    const id = enqueue({ kind: 'text', payload: { text: 'hello' } });
    expect(typeof id).toBe('string');
    expect(id.startsWith('q-')).toBe(true);
  });

  it('list returns items in insertion order', () => {
    enqueue({ kind: 'text', payload: { text: 'a' } });
    enqueue({ kind: 'text', payload: { text: 'b' } });
    const items = list();
    expect(items.length).toBe(2);
    expect(items[0].payload.text).toBe('a');
    expect(items[1].payload.text).toBe('b');
  });

  it('round-trip: list after enqueue gives back the same data', () => {
    const id = enqueue({
      kind: 'text',
      payload: { text: 'hello', workspace: '/ws', sessionId: 'sid' },
    });
    const items = list();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(id);
    expect(items[0].kind).toBe('text');
    expect(items[0].payload.text).toBe('hello');
    expect(items[0].payload.workspace).toBe('/ws');
    expect(items[0].payload.sessionId).toBe('sid');
  });

  it('persists across instance reconstruction (simulating reload)', () => {
    enqueue({ kind: 'text', payload: { text: 'persisted' } });

    // Simulate a fresh import by re-reading from the same localStorage store.
    const raw = store[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as QueuedItem[];
    expect(parsed.length).toBe(1);
    expect(parsed[0].payload.text).toBe('persisted');
  });

  it('remove deletes the item with the given id', () => {
    const id1 = enqueue({ kind: 'text', payload: { text: 'keep' } });
    const id2 = enqueue({ kind: 'text', payload: { text: 'remove me' } });

    remove(id2);

    const items = list();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(id1);
  });

  it('remove is a no-op for an unknown id', () => {
    enqueue({ kind: 'text', payload: { text: 'x' } });
    expect(() => remove('nonexistent')).not.toThrow();
    expect(list().length).toBe(1);
  });

  it('clear empties the queue', () => {
    enqueue({ kind: 'text', payload: { text: 'x' } });
    enqueue({ kind: 'text', payload: { text: 'y' } });
    clear();
    expect(list().length).toBe(0);
  });

  describe('onChange', () => {
    it('fires when an item is enqueued', () => {
      const cb = vi.fn();
      const unsub = onChange(cb);
      enqueue({ kind: 'text', payload: { text: 'fire' } });
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('fires when an item is removed', () => {
      const id = enqueue({ kind: 'text', payload: { text: 'x' } });
      const cb = vi.fn();
      const unsub = onChange(cb);
      remove(id);
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('fires when the queue is cleared', () => {
      enqueue({ kind: 'text', payload: { text: 'x' } });
      const cb = vi.fn();
      const unsub = onChange(cb);
      clear();
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribe stops future notifications', () => {
      const cb = vi.fn();
      const unsub = onChange(cb);
      unsub();
      enqueue({ kind: 'text', payload: { text: 'x' } });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('localStorage corruption', () => {
    it('falls back to an empty queue without throwing', () => {
      // Seed corrupted data directly.
      store[STORAGE_KEY] = '{invalid json[[[';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => list()).not.toThrow();
      expect(list()).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('can enqueue after corruption (self-heals)', () => {
      store[STORAGE_KEY] = 'not-valid-json';
      const id = enqueue({ kind: 'text', payload: { text: 'after corrupt' } });
      const items = list();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(id);
    });
  });
});
