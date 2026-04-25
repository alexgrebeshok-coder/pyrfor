// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPriorityQueue,
  createDelayedQueue,
  createWorkScheduler,
} from './priority-queue.js';

// ─── createPriorityQueue ──────────────────────────────────────────────────────

describe('createPriorityQueue', () => {
  // ── min-heap basics ──────────────────────────────────────────────────────

  it('pop returns smallest element in min mode (default)', () => {
    const q = createPriorityQueue<number>();
    q.push(5);
    q.push(1);
    q.push(3);
    expect(q.pop()).toBe(1);
    expect(q.pop()).toBe(3);
    expect(q.pop()).toBe(5);
  });

  it('pop on empty queue returns undefined', () => {
    const q = createPriorityQueue<number>();
    expect(q.pop()).toBeUndefined();
  });

  it('peek returns root without removing it', () => {
    const q = createPriorityQueue<number>();
    q.push(7);
    q.push(2);
    expect(q.peek()).toBe(2);
    expect(q.size).toBe(2); // not removed
    expect(q.peek()).toBe(2);
  });

  it('peek on empty queue returns undefined', () => {
    expect(createPriorityQueue<number>().peek()).toBeUndefined();
  });

  it('size tracks pushes and pops', () => {
    const q = createPriorityQueue<number>();
    expect(q.size).toBe(0);
    q.push(1);
    q.push(2);
    expect(q.size).toBe(2);
    q.pop();
    expect(q.size).toBe(1);
    q.pop();
    expect(q.size).toBe(0);
  });

  it('clear empties the queue', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([3, 1, 4, 1, 5]);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.pop()).toBeUndefined();
  });

  it('toArray returns all items (heap order, no removal)', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([3, 1, 2]);
    const arr = q.toArray();
    expect(arr).toHaveLength(3);
    expect(arr.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(q.size).toBe(3); // items not consumed
  });

  // ── max mode ─────────────────────────────────────────────────────────────

  it('max mode pops largest element first', () => {
    const q = createPriorityQueue<number>({ mode: 'max' });
    q.pushAll([3, 9, 1, 7, 5]);
    expect(q.pop()).toBe(9);
    expect(q.pop()).toBe(7);
    expect(q.pop()).toBe(5);
  });

  it('max mode: full drain is descending', () => {
    const q = createPriorityQueue<number>({ mode: 'max' });
    q.pushAll([4, 2, 8, 6, 10]);
    const out: number[] = [];
    while (q.size) out.push(q.pop() as number);
    expect(out).toEqual([10, 8, 6, 4, 2]);
  });

  // ── custom comparator ────────────────────────────────────────────────────

  it('custom comparator sorts objects by priority field (lower = higher priority)', () => {
    type Task = { name: string; priority: number };
    const q = createPriorityQueue<Task>({
      comparator: (a, b) => a.priority - b.priority,
    });
    q.push({ name: 'low', priority: 10 });
    q.push({ name: 'high', priority: 1 });
    q.push({ name: 'med', priority: 5 });
    expect(q.pop()?.name).toBe('high');
    expect(q.pop()?.name).toBe('med');
    expect(q.pop()?.name).toBe('low');
  });

  it('custom comparator with mode ignored when comparator supplied', () => {
    // Comparator says smaller = higher priority → effectively min-heap regardless of mode
    const q = createPriorityQueue<number>({
      mode: 'max',
      comparator: (a, b) => a - b,
    });
    q.pushAll([5, 1, 3]);
    expect(q.pop()).toBe(1); // comparator wins
  });

  // ── pushAll ───────────────────────────────────────────────────────────────

  it('pushAll preserves min-heap invariant', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([5, 3, 8, 1, 9, 2, 7]);
    const out: number[] = [];
    while (q.size) out.push(q.pop() as number);
    expect(out).toEqual([1, 2, 3, 5, 7, 8, 9]);
  });

  it('pushAll on an already-populated queue remains correct', () => {
    const q = createPriorityQueue<number>();
    q.push(4);
    q.pushAll([2, 6]);
    expect(q.pop()).toBe(2);
    expect(q.pop()).toBe(4);
    expect(q.pop()).toBe(6);
  });

  // ── popMany ───────────────────────────────────────────────────────────────

  it('popMany returns N items in sorted order', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([7, 1, 5, 3, 9]);
    expect(q.popMany(3)).toEqual([1, 3, 5]);
    expect(q.size).toBe(2);
  });

  it('popMany returns fewer than N when queue has fewer items', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([2, 1]);
    const result = q.popMany(10);
    expect(result).toEqual([1, 2]);
    expect(q.size).toBe(0);
  });

  // ── update ────────────────────────────────────────────────────────────────

  it('update replaces item and sifts it up (decrease-key)', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 5, 3, 7, 9]);
    const ok = q.update(9, 0);
    expect(ok).toBe(true);
    expect(q.pop()).toBe(0); // 0 should now be at root
    expect(q.pop()).toBe(1);
  });

  it('update replaces item and sifts it down (increase-key)', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 5, 3, 7, 9]);
    q.update(1, 100);
    const out: number[] = [];
    while (q.size) out.push(q.pop() as number);
    expect(out).toEqual([3, 5, 7, 9, 100]);
  });

  it('update returns false when item is not found', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 2, 3]);
    expect(q.update(99, 0)).toBe(false);
    expect(q.size).toBe(3);
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove deletes one occurrence and preserves invariant', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([5, 3, 8, 1, 7]);
    expect(q.remove(3)).toBe(true);
    const out: number[] = [];
    while (q.size) out.push(q.pop() as number);
    expect(out).toEqual([1, 5, 7, 8]);
  });

  it('remove the root element', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 2, 3]);
    q.remove(1);
    expect(q.pop()).toBe(2);
  });

  it('remove the last element', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 2, 3]);
    q.remove(3);
    const out: number[] = [];
    while (q.size) out.push(q.pop() as number);
    expect(out).toEqual([1, 2]);
  });

  it('remove returns false when item is not found', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([1, 2, 3]);
    expect(q.remove(99)).toBe(false);
    expect(q.size).toBe(3);
  });

  it('remove only deletes one occurrence when duplicates exist', () => {
    const q = createPriorityQueue<number>();
    q.pushAll([5, 5, 5]);
    q.remove(5);
    expect(q.size).toBe(2);
  });

  // ── large random sort ─────────────────────────────────────────────────────

  it('large random insert+pop yields ascending sorted output (1000 items)', () => {
    const q = createPriorityQueue<number>();
    const items = Array.from({ length: 1000 }, () =>
      Math.floor(Math.random() * 100_000),
    );
    for (const n of items) q.push(n);
    const expected = [...items].sort((a, b) => a - b);
    const got: number[] = [];
    while (q.size) got.push(q.pop() as number);
    expect(got).toEqual(expected);
  });
});

// ─── createDelayedQueue ───────────────────────────────────────────────────────

describe('createDelayedQueue', () => {
  let fakeNow: number;
  let pendingTimers: Map<number, { fn: () => void; fireAt: number }>;
  let nextId: number;

  const clock = (): number => fakeNow;

  const setTimer = (fn: () => void, ms: number): number => {
    const id = nextId++;
    pendingTimers.set(id, { fn, fireAt: fakeNow + ms });
    return id;
  };

  const clearTimer = (id: unknown): void => {
    pendingTimers.delete(id as number);
  };

  /** Advance fake clock and fire all timers that become due, in chronological order. */
  const advance = (ms: number): void => {
    fakeNow += ms;
    const due = [...pendingTimers.entries()]
      .filter(([, t]) => t.fireAt <= fakeNow)
      .sort((a, b) => a[1].fireAt - b[1].fireAt);
    for (const [id, timer] of due) {
      if (pendingTimers.has(id)) {
        pendingTimers.delete(id);
        timer.fn();
      }
    }
  };

  beforeEach(() => {
    fakeNow = 0;
    pendingTimers = new Map();
    nextId = 1;
  });

  it('fires item after delayMs', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(42, { delayMs: 100 });
    expect(fired).toEqual([]);
    advance(100);
    expect(fired).toEqual([42]);
  });

  it('does not fire before delayMs elapses', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(1, { delayMs: 200 });
    advance(150);
    expect(fired).toEqual([]);
    advance(50);
    expect(fired).toEqual([1]);
  });

  it('cancel prevents the item from firing', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    const h = q.schedule(99, { delayMs: 100 });
    h.cancel();
    advance(200);
    expect(fired).toEqual([]);
  });

  it('cancelling one item does not prevent others from firing', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(1, { delayMs: 100 });
    const h = q.schedule(2, { delayMs: 100 });
    h.cancel();
    advance(100);
    expect(fired).toEqual([1]);
  });

  it('multiple items with different runAt fire in order', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(1, { delayMs: 100 });
    q.schedule(2, { delayMs: 200 });
    q.schedule(3, { delayMs: 300 });
    advance(100);
    expect(fired).toEqual([1]);
    advance(100);
    expect(fired).toEqual([1, 2]);
    advance(100);
    expect(fired).toEqual([1, 2, 3]);
  });

  it('items scheduled with the same runAt fire in the same handler call', () => {
    const batches: number[][] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => batches.push([...items]));
    q.schedule(10, { delayMs: 50 });
    q.schedule(20, { delayMs: 50 });
    advance(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('schedule with absolute runAtMs timestamp', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(77, 500); // absolute ms
    advance(499);
    expect(fired).toEqual([]);
    advance(1);
    expect(fired).toEqual([77]);
  });

  it('clear cancels all pending items and disarms timer', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(1, { delayMs: 100 });
    q.schedule(2, { delayMs: 200 });
    q.clear();
    expect(q.count()).toBe(0);
    advance(300);
    expect(fired).toEqual([]);
    // No orphaned timers remain
    expect(pendingTimers.size).toBe(0);
  });

  it('count reflects scheduled (non-cancelled) items', () => {
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.schedule(1, { delayMs: 100 });
    const h = q.schedule(2, { delayMs: 200 });
    expect(q.count()).toBe(2);
    h.cancel();
    expect(q.count()).toBe(1);
  });

  it('pending returns non-cancelled items with correct metadata', () => {
    const q = createDelayedQueue<string>({ clock, setTimer, clearTimer });
    const h1 = q.schedule('a', { delayMs: 100 });
    q.schedule('b', { delayMs: 200 });
    h1.cancel();
    const p = q.pending();
    expect(p).toHaveLength(1);
    expect(p[0]?.item).toBe('b');
    expect(p[0]?.runAtMs).toBe(200);
  });

  it('nextRunAt returns the earliest scheduled runAtMs', () => {
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.schedule(1, { delayMs: 300 });
    q.schedule(2, { delayMs: 100 });
    q.schedule(3, { delayMs: 200 });
    expect(q.nextRunAt()).toBe(100);
  });

  it('nextRunAt returns undefined when queue is empty', () => {
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    expect(q.nextRunAt()).toBeUndefined();
  });

  it('nextRunAt skips cancelled items', () => {
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    const h = q.schedule(1, { delayMs: 50 });
    q.schedule(2, { delayMs: 200 });
    h.cancel();
    expect(q.nextRunAt()).toBe(200);
  });

  it('handler is not called when all ready items are cancelled', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    const h = q.schedule(5, { delayMs: 100 });
    h.cancel();
    advance(100);
    expect(fired).toEqual([]);
  });

  it('re-arms correctly after a batch fires and more items remain', () => {
    const fired: number[] = [];
    const q = createDelayedQueue<number>({ clock, setTimer, clearTimer });
    q.onReady((items) => fired.push(...items));
    q.schedule(1, { delayMs: 100 });
    q.schedule(2, { delayMs: 200 });
    advance(100); // fires item 1
    expect(fired).toEqual([1]);
    expect(q.count()).toBe(1);
    advance(100); // fires item 2
    expect(fired).toEqual([1, 2]);
  });
});

// ─── createWorkScheduler ──────────────────────────────────────────────────────

describe('createWorkScheduler', () => {
  it('submit resolves with the work function result', async () => {
    const s = createWorkScheduler<string>();
    const result = await s.submit('hello', async (item) => item.toUpperCase());
    expect(result).toBe('HELLO');
  });

  it('submit rejects when the work function rejects', async () => {
    const s = createWorkScheduler<string>();
    await expect(
      s.submit('x', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('stats().inFlight respects concurrency limit', () => {
    const s = createWorkScheduler<number>({ concurrency: 2 });
    const never = new Promise<void>(() => { /* intentionally never resolves */ });
    s.submit(1, () => never);
    s.submit(2, () => never);
    s.submit(3, () => never);
    s.submit(4, () => never);
    const { inFlight, queued } = s.stats();
    expect(inFlight).toBe(2);
    expect(queued).toBe(2);
  });

  it('completed counter increments on success', async () => {
    const s = createWorkScheduler<number>();
    await s.submit(1, async (n) => n * 2);
    await s.submit(2, async (n) => n * 2);
    expect(s.stats().completed).toBe(2);
  });

  it('failed counter increments on rejection', async () => {
    const s = createWorkScheduler<number>({ onError: () => { /* suppress */ } });
    await expect(s.submit(1, async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(s.stats().failed).toBe(1);
    expect(s.stats().completed).toBe(0);
  });

  it('processes higher-priority items first (custom comparator)', async () => {
    const order: number[] = [];
    const s = createWorkScheduler<number>({
      concurrency: 1,
      comparator: (a, b) => a - b, // lower number = higher priority
    });

    let unlockFirst!: () => void;
    const latch = new Promise<void>((r) => { unlockFirst = r; });

    const p1 = s.submit(10, () => latch.then(() => { order.push(10); }));
    const p3 = s.submit(3, async () => { order.push(3); });
    const p7 = s.submit(7, async () => { order.push(7); });

    unlockFirst();
    await Promise.all([p1, p3, p7]);

    expect(order).toEqual([10, 3, 7]); // 10 was already running; 3 next (priority), then 7
  });

  it('pause halts new task starts', () => {
    const s = createWorkScheduler<number>({ concurrency: 4 });
    s.pause();
    s.submit(1, async () => 1);
    s.submit(2, async () => 2);
    expect(s.stats().inFlight).toBe(0);
    expect(s.stats().queued).toBe(2);
  });

  it('resume continues queued tasks', async () => {
    const s = createWorkScheduler<number>({ concurrency: 2 });
    s.pause();
    const results: number[] = [];
    const p1 = s.submit(1, async (n) => { results.push(n); return n; });
    const p2 = s.submit(2, async (n) => { results.push(n); return n; });
    expect(s.stats().inFlight).toBe(0);
    s.resume();
    await Promise.all([p1, p2]);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(s.stats().completed).toBe(2);
  });

  it('pause does not interrupt already in-flight tasks', async () => {
    const s = createWorkScheduler<number>({ concurrency: 2 });
    let resolveTask!: (v: number) => void;
    const p = s.submit(1, () => new Promise<number>((r) => { resolveTask = r; }));
    s.pause();
    resolveTask(42);
    const val = await p;
    expect(val).toBe(42);
    expect(s.stats().completed).toBe(1);
  });

  it('onError is called with the error and item', async () => {
    const errors: Array<[unknown, number]> = [];
    const s = createWorkScheduler<number>({
      onError: (err, item) => errors.push([err, item]),
    });
    await expect(
      s.submit(7, async () => { throw new Error('oops'); }),
    ).rejects.toThrow('oops');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[1]).toBe(7);
    expect(errors[0]?.[0]).toBeInstanceOf(Error);
  });

  it('onError exceptions are swallowed and scheduler remains functional', async () => {
    const s = createWorkScheduler<string>({
      onError: () => { throw new Error('handler exploded'); },
    });
    await expect(
      s.submit('a', async () => { throw new Error('work failed'); }),
    ).rejects.toThrow('work failed');
    // Scheduler must still function after the handler explosion
    const val = await s.submit('b', async (item) => item + '!');
    expect(val).toBe('b!');
  });

  it('stats() returns correct queued count as items are processed', async () => {
    const s = createWorkScheduler<number>({ concurrency: 1 });
    const never = new Promise<void>(() => { /* never resolves */ });
    s.submit(1, () => never);
    s.submit(2, async () => { /* */ });
    s.submit(3, async () => { /* */ });
    expect(s.stats().queued).toBe(2);
    expect(s.stats().inFlight).toBe(1);
  });

  it('default concurrency is 4', () => {
    const s = createWorkScheduler<number>();
    const never = new Promise<void>(() => { /* never resolves */ });
    for (let i = 0; i < 6; i++) s.submit(i, () => never);
    expect(s.stats().inFlight).toBe(4);
    expect(s.stats().queued).toBe(2);
  });
});
