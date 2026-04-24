// @vitest-environment node
/**
 * task-queue.test.ts — ≥40 tests for the persistent priority task queue.
 *
 * Uses injected clock + setTimer/clearTimer for fully deterministic scheduling.
 * Disk-persistence tests write to a project-local tmp directory (no /tmp).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTaskQueue, type Task, type TaskState } from './task-queue.js';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Project-local tmp dir for persistence tests ────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = path.join(__dir, '__tq_test_tmp__');

let storeCounter = 0;
function tmpStore(): string {
  mkdirSync(TEST_STORE_DIR, { recursive: true });
  return path.join(TEST_STORE_DIR, `tq-${Date.now()}-${++storeCounter}.json`);
}

afterEach(() => {
  try {
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ── Fake timer / clock helpers ─────────────────────────────────────────────

interface FakeTimers {
  clock: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  /** Advance fake time and fire any due timers. */
  advance: (ms: number) => void;
  /** Fire all pending timers immediately (up to limit). */
  flush: (limit?: number) => void;
  now: number;
}

function makeFakeTimers(start = 0): FakeTimers {
  let now = start;
  interface Entry { at: number; cb: () => void; id: number; cancelled: boolean }
  const pending: Entry[] = [];
  let nextId = 1;

  const clock = () => now;
  const setTimer = (cb: () => void, ms: number): number => {
    const id = nextId++;
    pending.push({ at: now + ms, cb, id, cancelled: false });
    pending.sort((a, b) => a.at - b.at);
    return id;
  };
  const clearTimer = (h: unknown) => {
    const e = pending.find((p) => p.id === h);
    if (e) e.cancelled = true;
  };

  const advance = (ms: number) => {
    now += ms;
    const due = pending.filter((p) => p.at <= now && !p.cancelled);
    pending.splice(0, pending.length, ...pending.filter((p) => p.at > now || p.cancelled));
    for (const p of due) if (!p.cancelled) p.cb();
  };

  const flush = (limit = 100) => {
    for (let i = 0; i < limit; i++) {
      const next = pending.find((p) => !p.cancelled);
      if (!next) break;
      now = Math.max(now, next.at);
      pending.splice(pending.indexOf(next), 1);
      if (!next.cancelled) next.cb();
    }
  };

  return {
    clock,
    setTimer,
    clearTimer,
    advance,
    flush,
    get now() { return now; },
  };
}

/** Resolve all pending microtasks. */
async function tick(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function flushMicrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

// ── 1. Basic handler registration and execution ────────────────────────────

describe('registerHandler + enqueue + start', () => {
  it('calls the handler when a task is enqueued and queue started', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const calls: string[] = [];
    q.registerHandler('ping', async () => { calls.push('ping'); });

    q.start();
    q.enqueue({ kind: 'ping' });
    await flushMicrotasks();

    expect(calls).toEqual(['ping']);
  });

  it('works when start() is called after enqueue()', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const called: boolean[] = [];
    q.registerHandler('job', async () => { called.push(true); });

    q.enqueue({ kind: 'job' });
    q.start();
    await flushMicrotasks();

    expect(called.length).toBe(1);
  });

  it('passes the task object to the handler', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    let received: Task | undefined;
    q.registerHandler('info', async (task) => { received = task; });

    q.start();
    q.enqueue({ kind: 'info', payload: { x: 42 } });
    await flushMicrotasks();

    expect(received?.kind).toBe('info');
    expect(received?.payload).toEqual({ x: 42 });
  });

  it('task transitions to done after handler resolves', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('noop', async () => {});

    q.start();
    const task = q.enqueue({ kind: 'noop' });
    await flushMicrotasks();

    expect(q.get(task.id)?.state).toBe('done');
  });
});

// ── 2. Priority ordering ───────────────────────────────────────────────────

describe('priority', () => {
  it('runs higher priority tasks before lower priority', async () => {
    const ft = makeFakeTimers();
    const q = createTaskQueue({ concurrency: 1, clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    const order: number[] = [];
    q.registerHandler('job', async (t) => { order.push(t.priority); });

    // enqueue BEFORE start so they all start queued
    q.enqueue({ kind: 'job', priority: 1 });
    q.enqueue({ kind: 'job', priority: 5 });
    q.enqueue({ kind: 'job', priority: 3 });

    q.start();
    await flushMicrotasks(20);

    expect(order[0]).toBe(5);
    expect(order[1]).toBe(3);
    expect(order[2]).toBe(1);
  });

  it('ties are broken by createdAt ascending (FIFO)', async () => {
    const ft = makeFakeTimers();
    let t = 0;
    const q = createTaskQueue({
      concurrency: 1,
      clock: () => t++,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    const order: string[] = [];
    q.registerHandler('job', async (task) => { order.push(task.payload.name as string); });

    q.enqueue({ kind: 'job', priority: 0, payload: { name: 'first' } });
    q.enqueue({ kind: 'job', priority: 0, payload: { name: 'second' } });
    q.enqueue({ kind: 'job', priority: 0, payload: { name: 'third' } });

    q.start();
    await flushMicrotasks(20);

    expect(order).toEqual(['first', 'second', 'third']);
  });
});

// ── 3. Deduplication ──────────────────────────────────────────────────────

describe('dedupKey', () => {
  it('returns existing task if same dedupKey is already queued', () => {
    const q = createTaskQueue({ concurrency: 1 });
    const t1 = q.enqueue({ kind: 'x', dedupKey: 'k1' });
    const t2 = q.enqueue({ kind: 'x', dedupKey: 'k1' });
    expect(t1.id).toBe(t2.id);
  });

  it('returns existing task if same dedupKey is running', async () => {
    let release!: () => void;
    const q = createTaskQueue({ concurrency: 2 });
    q.registerHandler('x', () => new Promise<void>((r) => { release = r; }));

    q.start();
    const t1 = q.enqueue({ kind: 'x', dedupKey: 'k2' });
    await flushMicrotasks();
    expect(q.get(t1.id)?.state).toBe('running');

    const t2 = q.enqueue({ kind: 'x', dedupKey: 'k2' });
    expect(t1.id).toBe(t2.id);
    release();
  });

  it('allows new task with same dedupKey once original is done', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('x', async () => {});

    q.start();
    const t1 = q.enqueue({ kind: 'x', dedupKey: 'k3' });
    await flushMicrotasks();
    expect(q.get(t1.id)?.state).toBe('done');

    const t2 = q.enqueue({ kind: 'x', dedupKey: 'k3' });
    expect(t2.id).not.toBe(t1.id);
  });

  it('allows new task once original is failed', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('x', async () => { throw new Error('boom'); });

    q.start();
    const t1 = q.enqueue({ kind: 'x', dedupKey: 'k4', maxAttempts: 1 });
    await flushMicrotasks();
    expect(q.get(t1.id)?.state).toBe('failed');

    const t2 = q.enqueue({ kind: 'x', dedupKey: 'k4', maxAttempts: 1 });
    expect(t2.id).not.toBe(t1.id);
  });

  it('allows new task once original is cancelled', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const t1 = q.enqueue({ kind: 'x', dedupKey: 'k5' });
    q.cancel(t1.id);

    const t2 = q.enqueue({ kind: 'x', dedupKey: 'k5' });
    expect(t2.id).not.toBe(t1.id);
  });
});

// ── 4. Retries with exponential backoff ───────────────────────────────────

describe('retries', () => {
  it('retries a failing task up to maxAttempts', async () => {
    const ft = makeFakeTimers();
    let callCount = 0;
    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    q.registerHandler('flaky', async () => {
      callCount++;
      throw new Error('fail');
    });

    q.start();
    const task = q.enqueue({ kind: 'flaky', maxAttempts: 3 });

    // Attempt 1
    await flushMicrotasks();
    expect(task.attempts).toBe(1);
    expect(task.state).toBe('queued'); // re-queued for retry

    // Advance past backoff delay (2^1 * 1000 = 2000 ms)
    ft.advance(2000);
    await flushMicrotasks();
    expect(task.attempts).toBe(2);

    // Advance past backoff delay (2^2 * 1000 = 4000 ms)
    ft.advance(4000);
    await flushMicrotasks();
    expect(task.attempts).toBe(3);
    expect(task.state).toBe('failed');
    expect(callCount).toBe(3);
  });

  it('exponential backoff: delay doubles each attempt', async () => {
    const ft = makeFakeTimers();
    const retryDelays: number[] = [];
    let lastRetryAt = 0;

    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    q.on('retry', (t) => {
      if (t?.runAt !== undefined) {
        retryDelays.push(t.runAt - ft.now);
        lastRetryAt = t.runAt;
      }
    });

    q.registerHandler('bad', async () => { throw new Error('x'); });
    q.start();
    q.enqueue({ kind: 'bad', maxAttempts: 4 });

    await flushMicrotasks();
    expect(retryDelays[0]).toBe(2000); // 2^1 * 1000

    ft.advance(2001);
    await flushMicrotasks();
    expect(retryDelays[1]).toBe(4000); // 2^2 * 1000

    ft.advance(4001);
    await flushMicrotasks();
    expect(retryDelays[2]).toBe(8000); // 2^3 * 1000
  });

  it('caps backoff at 60 000 ms', async () => {
    const ft = makeFakeTimers();
    let capturedDelay = 0;

    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    q.on('retry', (t) => {
      if (t?.runAt !== undefined) capturedDelay = t.runAt - ft.now;
    });

    // After 7th attempt: 2^7 * 1000 = 128 000 > 60 000, should cap
    let attempt = 0;
    q.registerHandler('cap', async () => {
      attempt++;
      throw new Error('x');
    });

    q.start();
    q.enqueue({ kind: 'cap', maxAttempts: 10 });

    for (let i = 0; i < 7; i++) {
      await flushMicrotasks();
      ft.advance(65_000); // advance past any delay
    }

    expect(capturedDelay).toBeLessThanOrEqual(60_000);
  });

  it('sets state to failed when attempts exhausted', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('fail', async () => { throw new Error('oops'); });

    q.start();
    const task = q.enqueue({ kind: 'fail', maxAttempts: 1 });
    await flushMicrotasks();

    expect(task.state).toBe('failed');
    expect(task.lastError).toBe('oops');
    expect(task.finishedAt).toBeDefined();
  });

  it('does not retry when maxAttempts=1', async () => {
    let calls = 0;
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('once', async () => { calls++; throw new Error('x'); });

    q.start();
    q.enqueue({ kind: 'once', maxAttempts: 1 });
    await flushMicrotasks();

    expect(calls).toBe(1);
  });
});

// ── 5. Cancellation ───────────────────────────────────────────────────────

describe('cancel', () => {
  it('cancels a queued task', () => {
    const q = createTaskQueue({ concurrency: 1 });
    const task = q.enqueue({ kind: 'job' });
    const ok = q.cancel(task.id);

    expect(ok).toBe(true);
    expect(task.state).toBe('cancelled');
    expect(task.finishedAt).toBeDefined();
  });

  it('cancel queued: emit cancelled event', () => {
    const q = createTaskQueue({ concurrency: 1 });
    const events: string[] = [];
    q.on('cancelled', () => events.push('cancelled'));

    const task = q.enqueue({ kind: 'job' });
    q.cancel(task.id);

    expect(events).toContain('cancelled');
  });

  it('cancels a running task and aborts signal', async () => {
    let aborted = false;
    let release!: () => void;
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('long', (_task, signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise<void>((r) => { release = r; });
    });

    q.start();
    const task = q.enqueue({ kind: 'long' });
    await flushMicrotasks();
    expect(task.state).toBe('running');

    q.cancel(task.id);
    expect(aborted).toBe(true);
    expect(task.state).toBe('cancelled');

    release();
    await flushMicrotasks();
  });

  it('returns false for unknown id', () => {
    const q = createTaskQueue();
    expect(q.cancel('nonexistent')).toBe(false);
  });

  it('returns false for already done task', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('done', async () => {});
    q.start();
    const task = q.enqueue({ kind: 'done' });
    await flushMicrotasks();

    expect(task.state).toBe('done');
    expect(q.cancel(task.id)).toBe(false);
  });

  it('returns false for already cancelled task', () => {
    const q = createTaskQueue({ concurrency: 1 });
    const task = q.enqueue({ kind: 'job' });
    q.cancel(task.id);
    expect(q.cancel(task.id)).toBe(false);
  });

  it('returns false for already failed task', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('bad', async () => { throw new Error(); });
    q.start();
    const task = q.enqueue({ kind: 'bad', maxAttempts: 1 });
    await flushMicrotasks();
    expect(q.cancel(task.id)).toBe(false);
  });
});

// ── 6. Concurrency cap ────────────────────────────────────────────────────

describe('concurrency', () => {
  it('respects concurrency cap (cap=2, enqueue 5)', async () => {
    let peakRunning = 0;
    let currentRunning = 0;
    const releases: Array<() => void> = [];

    const q = createTaskQueue({ concurrency: 2 });
    q.registerHandler('work', (_task, signal) =>
      new Promise<void>((resolve) => {
        currentRunning++;
        peakRunning = Math.max(peakRunning, currentRunning);
        releases.push(() => { currentRunning--; resolve(); });
      }),
    );

    q.start();
    for (let i = 0; i < 5; i++) q.enqueue({ kind: 'work' });

    await flushMicrotasks();
    expect(peakRunning).toBeLessThanOrEqual(2);

    // drain all
    for (const r of [...releases]) r();
    await flushMicrotasks();
    for (const r of [...releases]) r();
    await flushMicrotasks();
  });

  it('runs multiple tasks up to the concurrency cap', async () => {
    const started: number[] = [];
    const releases: Array<() => void> = [];

    const q = createTaskQueue({ concurrency: 3 });
    q.registerHandler('task', (t) =>
      new Promise<void>((r) => {
        started.push(t.priority);
        releases.push(r);
      }),
    );

    q.start();
    q.enqueue({ kind: 'task' });
    q.enqueue({ kind: 'task' });
    q.enqueue({ kind: 'task' });

    await flushMicrotasks();
    expect(started.length).toBe(3);

    for (const r of releases) r();
    await flushMicrotasks();
  });

  it('starts next task when a slot frees up', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;

    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('job', async (t) => {
      if (t.payload?.name === 'first') {
        await new Promise<void>((r) => { releaseFirst = r; });
      }
      order.push(t.payload?.name as string);
    });

    q.start();
    q.enqueue({ kind: 'job', payload: { name: 'first' } });
    q.enqueue({ kind: 'job', payload: { name: 'second' } });

    await flushMicrotasks();
    releaseFirst();
    await flushMicrotasks();

    expect(order).toEqual(['first', 'second']);
  });
});

// ── 7. runAt (scheduled future tasks) ────────────────────────────────────

describe('runAt', () => {
  it('does not run a task before runAt', async () => {
    const ft = makeFakeTimers(0);
    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    let ran = false;
    q.registerHandler('future', async () => { ran = true; });

    q.start();
    q.enqueue({ kind: 'future', runAt: 5000 });

    await flushMicrotasks();
    expect(ran).toBe(false);
  });

  it('runs a task after runAt time elapses', async () => {
    const ft = makeFakeTimers(0);
    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    let ran = false;
    q.registerHandler('future', async () => { ran = true; });

    q.start();
    q.enqueue({ kind: 'future', runAt: 1000 });

    await flushMicrotasks();
    ft.advance(1001); // triggers scheduled tick
    await flushMicrotasks();
    expect(ran).toBe(true);
  });
});

// ── 8. Persistence ────────────────────────────────────────────────────────

describe('persistence', () => {
  it('saves tasks to disk on enqueue (after debounce)', async () => {
    const ft = makeFakeTimers();
    const store = tmpStore();
    const q = createTaskQueue({
      storePath: store,
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    q.registerHandler('job', async () => {});

    q.start();
    q.enqueue({ kind: 'job' });

    ft.advance(600); // past default debounce 500 ms
    await flushMicrotasks();

    expect(existsSync(store)).toBe(true);
  });

  it('reloads tasks from disk on start()', async () => {
    const ft = makeFakeTimers();
    const store = tmpStore();

    // Queue 1: enqueue and persist
    const q1 = createTaskQueue({
      storePath: store,
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    q1.registerHandler('job', async () => {});
    q1.start();
    q1.enqueue({ kind: 'job', payload: { label: 'persisted' } });
    ft.advance(600);
    await flushMicrotasks();
    await q1.stop();

    // Queue 2: reload from same store
    const q2 = createTaskQueue({
      storePath: store,
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    q2.registerHandler('job', async () => {});
    q2.start();

    const tasks = q2.list();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.payload?.label === 'persisted')).toBe(true);
  });

  it('handles corrupt store gracefully (empty + warn)', () => {
    const store = tmpStore();
    mkdirSync(path.dirname(store), { recursive: true });
    writeFileSync(store, '{ this is not json !!!', 'utf8');

    const warnings: string[] = [];
    const q = createTaskQueue({
      storePath: store,
      logger: (msg) => warnings.push(msg),
    });
    q.start();

    expect(q.list().length).toBe(0);
    expect(warnings.some((w) => w.includes('corrupt'))).toBe(true);
  });

  it('resets running→queued on reload (crash recovery)', async () => {
    const ft = makeFakeTimers();
    const store = tmpStore();

    // Simulate a crash: manually write a task in 'running' state
    mkdirSync(path.dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify([
      { id: 'aabbccdd', kind: 'job', payload: null, priority: 0, attempts: 1,
        maxAttempts: 3, state: 'running', createdAt: 0 },
    ]), 'utf8');

    const q = createTaskQueue({
      storePath: store,
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    let ran = false;
    q.registerHandler('job', async () => { ran = true; });
    q.start();
    await flushMicrotasks();

    expect(ran).toBe(true);
  });
});

// ── 9. stop() / drain() ───────────────────────────────────────────────────

describe('stop and drain', () => {
  it('stop() waits for running tasks to complete', async () => {
    let release!: () => void;
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('long', () => new Promise<void>((r) => { release = r; }));

    q.start();
    q.enqueue({ kind: 'long' });
    await flushMicrotasks();

    const stopPromise = q.stop();
    let stopped = false;
    stopPromise.then(() => { stopped = true; });

    await flushMicrotasks();
    expect(stopped).toBe(false);

    release();
    await flushMicrotasks();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it('stop() aborts in-flight tasks', async () => {
    let signalAborted = false;
    let release!: () => void;

    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('long', (_t, signal) => {
      signal.addEventListener('abort', () => { signalAborted = true; });
      return new Promise<void>((r) => { release = r; });
    });

    q.start();
    q.enqueue({ kind: 'long' });
    await flushMicrotasks();

    q.stop();
    await flushMicrotasks();
    expect(signalAborted).toBe(true);
    release();
    await flushMicrotasks();
  });

  it('stop() resolves immediately if nothing is running', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.start();
    await expect(q.stop()).resolves.toBeUndefined();
  });

  it('drain() resolves after all queued+running tasks finish', async () => {
    const releases: Array<() => void> = [];
    const q = createTaskQueue({ concurrency: 2 });
    q.registerHandler('work', () => new Promise<void>((r) => releases.push(r)));

    q.start();
    q.enqueue({ kind: 'work' });
    q.enqueue({ kind: 'work' });
    await flushMicrotasks();

    const drainPromise = q.drain();
    let drained = false;
    drainPromise.then(() => { drained = true; });

    await flushMicrotasks();
    expect(drained).toBe(false);

    releases[0]!();
    await flushMicrotasks();
    expect(drained).toBe(false); // second still running

    releases[1]!();
    await flushMicrotasks();
    await drainPromise;
    expect(drained).toBe(true);
  });

  it('drain() resolves immediately when queue is already empty', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.start();
    await expect(q.drain()).resolves.toBeUndefined();
  });
});

// ── 10. Events ────────────────────────────────────────────────────────────

describe('events', () => {
  it('emits enqueued when a task is added', () => {
    const q = createTaskQueue();
    const events: Task[] = [];
    q.on('enqueued', (t) => { if (t) events.push(t); });
    q.enqueue({ kind: 'x' });
    expect(events.length).toBe(1);
    expect(events[0]!.kind).toBe('x');
  });

  it('emits started when execution begins', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const started: Task[] = [];
    q.on('started', (t) => { if (t) started.push(t); });
    q.registerHandler('x', async () => {});
    q.start();
    q.enqueue({ kind: 'x' });
    await flushMicrotasks();
    expect(started.length).toBe(1);
  });

  it('emits completed when handler resolves', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const completed: Task[] = [];
    q.on('completed', (t) => { if (t) completed.push(t); });
    q.registerHandler('x', async () => {});
    q.start();
    q.enqueue({ kind: 'x' });
    await flushMicrotasks();
    expect(completed.length).toBe(1);
  });

  it('emits failed when attempts exhausted', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    const failed: Task[] = [];
    q.on('failed', (t) => { if (t) failed.push(t); });
    q.registerHandler('x', async () => { throw new Error('boom'); });
    q.start();
    q.enqueue({ kind: 'x', maxAttempts: 1 });
    await flushMicrotasks();
    expect(failed.length).toBe(1);
  });

  it('emits retry when task is re-queued after failure', async () => {
    const ft = makeFakeTimers();
    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    const retries: Task[] = [];
    q.on('retry', (t) => { if (t) retries.push(t); });
    q.registerHandler('x', async () => { throw new Error('x'); });
    q.start();
    q.enqueue({ kind: 'x', maxAttempts: 2 });
    await flushMicrotasks();
    expect(retries.length).toBe(1);
  });

  it('emits cancelled when cancel() is called', () => {
    const q = createTaskQueue();
    const events: Task[] = [];
    q.on('cancelled', (t) => { if (t) events.push(t); });
    const t = q.enqueue({ kind: 'x' });
    q.cancel(t.id);
    expect(events.length).toBe(1);
  });

  it('emits idle after all tasks are finished', async () => {
    const q = createTaskQueue({ concurrency: 2 });
    q.registerHandler('j', async () => {});

    let idleCount = 0;
    q.on('idle', () => idleCount++);

    q.start();
    q.enqueue({ kind: 'j' });
    q.enqueue({ kind: 'j' });
    await flushMicrotasks(10);

    expect(idleCount).toBeGreaterThan(0);
  });

  it('on() returns an unsubscribe function', () => {
    const q = createTaskQueue();
    const events: Task[] = [];
    const unsub = q.on('enqueued', (t) => { if (t) events.push(t); });

    q.enqueue({ kind: 'x' });
    expect(events.length).toBe(1);

    unsub();
    q.enqueue({ kind: 'x' });
    expect(events.length).toBe(1); // not called after unsub
  });

  it('multiple listeners on same event all receive it', () => {
    const q = createTaskQueue();
    let a = 0, b = 0;
    q.on('enqueued', () => a++);
    q.on('enqueued', () => b++);
    q.enqueue({ kind: 'x' });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

// ── 11. get() / list() ────────────────────────────────────────────────────

describe('get and list', () => {
  it('get() returns task by id', () => {
    const q = createTaskQueue();
    const task = q.enqueue({ kind: 'a' });
    expect(q.get(task.id)).toBe(task);
  });

  it('get() returns undefined for unknown id', () => {
    const q = createTaskQueue();
    expect(q.get('nope')).toBeUndefined();
  });

  it('list() returns all tasks', () => {
    const q = createTaskQueue();
    q.enqueue({ kind: 'a' });
    q.enqueue({ kind: 'b' });
    expect(q.list().length).toBe(2);
  });

  it('list(state) filters by state', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('a', async () => {});
    q.start();
    q.enqueue({ kind: 'a' });
    q.enqueue({ kind: 'a' });
    await flushMicrotasks();

    expect(q.list({ state: 'done' }).length).toBe(2);
    expect(q.list({ state: 'queued' }).length).toBe(0);
  });

  it('list(kind) filters by kind', () => {
    const q = createTaskQueue();
    q.enqueue({ kind: 'alpha' });
    q.enqueue({ kind: 'beta' });
    q.enqueue({ kind: 'alpha' });
    expect(q.list({ kind: 'alpha' }).length).toBe(2);
    expect(q.list({ kind: 'beta' }).length).toBe(1);
  });
});

// ── 12. Default values and metadata ──────────────────────────────────────

describe('defaults and metadata', () => {
  it('default priority is 0', () => {
    const q = createTaskQueue();
    const t = q.enqueue({ kind: 'x' });
    expect(t.priority).toBe(0);
  });

  it('default maxAttempts is 3', () => {
    const q = createTaskQueue();
    const t = q.enqueue({ kind: 'x' });
    expect(t.maxAttempts).toBe(3);
  });

  it('default payload is null', () => {
    const q = createTaskQueue();
    const t = q.enqueue({ kind: 'x' });
    expect(t.payload).toBeNull();
  });

  it('task has correct createdAt from clock', () => {
    const ft = makeFakeTimers(12345);
    const q = createTaskQueue({ clock: ft.clock });
    const t = q.enqueue({ kind: 'x' });
    expect(t.createdAt).toBe(12345);
  });

  it('completed task has finishedAt set', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('x', async () => {});
    q.start();
    const t = q.enqueue({ kind: 'x' });
    await flushMicrotasks();
    expect(t.finishedAt).toBeDefined();
  });

  it('failed task has lastError set', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.registerHandler('bad', async () => { throw new Error('specific error'); });
    q.start();
    const t = q.enqueue({ kind: 'bad', maxAttempts: 1 });
    await flushMicrotasks();
    expect(t.lastError).toBe('specific error');
  });

  it('task without handler transitions to failed immediately', async () => {
    const q = createTaskQueue({ concurrency: 1 });
    q.start();
    const t = q.enqueue({ kind: 'orphan' });
    await flushMicrotasks();
    expect(t.state).toBe('failed');
    expect(t.lastError).toContain('No handler');
  });

  it('attempts count increments on each try', async () => {
    const ft = makeFakeTimers();
    const q = createTaskQueue({
      concurrency: 1,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    q.registerHandler('x', async () => { throw new Error(); });
    q.start();
    const t = q.enqueue({ kind: 'x', maxAttempts: 2 });

    await flushMicrotasks();
    expect(t.attempts).toBe(1);

    ft.advance(2001);
    await flushMicrotasks();
    expect(t.attempts).toBe(2);
    expect(t.state).toBe('failed');
  });

  it('initial state is queued', () => {
    const q = createTaskQueue();
    const t = q.enqueue({ kind: 'x' });
    expect(t.state).toBe('queued');
  });

  it('initial attempts is 0', () => {
    const q = createTaskQueue();
    const t = q.enqueue({ kind: 'x' });
    expect(t.attempts).toBe(0);
  });
});
