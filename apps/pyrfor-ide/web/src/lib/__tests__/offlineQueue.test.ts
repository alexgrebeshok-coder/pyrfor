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

  it('does not persist queued payloads to localStorage', () => {
    enqueue({
      kind: 'text',
      payload: {
        text: 'Bearer secret-token',
        workspace: '/Users/alice/private-workspace',
        openFiles: [{
          path: '/Users/alice/private-workspace/secret.md',
          content: 'github_pat_offline_secret',
        }],
      },
    });

    expect(list().length).toBe(1);
    expect(store[STORAGE_KEY]).toBeUndefined();
    expect(JSON.stringify(store)).not.toContain('secret-token');
    expect(JSON.stringify(store)).not.toContain('/Users/alice/private-workspace');
    expect(JSON.stringify(store)).not.toContain('github_pat_offline_secret');
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

  describe('legacy localStorage cleanup', () => {
    it('clears and ignores legacy persisted queue content', () => {
      store[STORAGE_KEY] = JSON.stringify([{
        id: 'legacy',
        ts: 1,
        kind: 'text',
        payload: { text: 'legacy ghp_secret', workspace: '/Users/alice/private' },
      } satisfies QueuedItem]);

      expect(list()).toEqual([]);
      expect(store[STORAGE_KEY]).toBeUndefined();
    });

    it('can enqueue after legacy corrupted data is cleared', () => {
      store[STORAGE_KEY] = 'not-valid-json';
      const id = enqueue({ kind: 'text', payload: { text: 'after corrupt' } });
      const items = list();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(id);
      expect(store[STORAGE_KEY]).toBeUndefined();
    });
  });
});
