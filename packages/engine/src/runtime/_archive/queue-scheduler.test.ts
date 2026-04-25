// @vitest-environment node
/**
 * queue-scheduler.test.ts — ≥30 tests for QueueScheduler.
 *
 * Uses injected clock + setTimer/clearTimer for fully deterministic scheduling.
 * Persistence tests write to a project-local tmp directory (never /tmp).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createQueueScheduler, type JobSchedule, type ScheduledJob } from './queue-scheduler.js';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Project-local tmp dir for persistence tests ────────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TEST_PERSIST_DIR = path.join(__dir, '__qs_test_tmp__');

let pathCounter = 0;
function tmpPath(): string {
  mkdirSync(TEST_PERSIST_DIR, { recursive: true });
  return path.join(TEST_PERSIST_DIR, `qs-${Date.now()}-${++pathCounter}.json`);
}

afterEach(() => {
  try {
    rmSync(TEST_PERSIST_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ── Fake timer / clock helpers ─────────────────────────────────────────────

interface FakeTimers {
  clock: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  advance: (ms: number) => void;
  readonly now: number;
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
    // Snapshot due entries before firing so newly-set timers aren't fired yet.
    const due = pending.filter((p) => p.at <= now && !p.cancelled);
    pending.splice(0, pending.length, ...pending.filter((p) => p.at > now || p.cancelled));
    for (const p of due) if (!p.cancelled) p.cb();
  };

  return {
    clock,
    setTimer,
    clearTimer,
    advance,
    get now() { return now; },
  };
}

/** Flush real microtasks (promise continuations). */
async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ── 1. add / get / list ────────────────────────────────────────────────────

describe('add / get / list', () => {
  it('add returns an id and get returns the job', () => {
    const s = createQueueScheduler();
    const id = s.add('job1', { kind: 'interval', everyMs: 1000 }, () => {});
    const job = s.get(id);
    expect(job).toBeDefined();
    expect(job!.id).toBe(id);
    expect(job!.name).toBe('job1');
  });

  it('list returns all added jobs', () => {
    const s = createQueueScheduler();
    s.add('a', { kind: 'interval', everyMs: 100 }, () => {});
    s.add('b', { kind: 'interval', everyMs: 200 }, () => {});
    expect(s.list()).toHaveLength(2);
  });

  it('job has correct initial state', () => {
    const ft = makeFakeTimers(5000);
    const s = createQueueScheduler({ clock: ft.clock });
    const id = s.add('j', { kind: 'interval', everyMs: 1000 }, () => {});
    const job = s.get(id)!;
    expect(job.enabled).toBe(true);
    expect(job.runCount).toBe(0);
    expect(job.failureCount).toBe(0);
    expect(job.lastRun).toBeUndefined();
  });

  it('meta is preserved on the job', () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {}, { color: 'red' });
    expect(s.get(id)!.meta).toEqual({ color: 'red' });
  });

  it('get returns undefined for unknown id', () => {
    const s = createQueueScheduler();
    expect(s.get('no-such-id')).toBeUndefined();
  });
});

// ── 2. remove ─────────────────────────────────────────────────────────────

describe('remove', () => {
  it('remove returns true and deletes the job', () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    expect(s.remove(id)).toBe(true);
    expect(s.get(id)).toBeUndefined();
    expect(s.list()).toHaveLength(0);
  });

  it('remove returns false for unknown id', () => {
    const s = createQueueScheduler();
    expect(s.remove('ghost')).toBe(false);
  });
});

// ── 3. enable / disable ───────────────────────────────────────────────────

describe('enable / disable', () => {
  it('disable sets enabled=false and returns true', () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    expect(s.disable(id)).toBe(true);
    expect(s.get(id)!.enabled).toBe(false);
  });

  it('enable sets enabled=true and returns true', () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    s.disable(id);
    expect(s.enable(id)).toBe(true);
    expect(s.get(id)!.enabled).toBe(true);
  });

  it('disable returns false for unknown id', () => {
    const s = createQueueScheduler();
    expect(s.disable('nope')).toBe(false);
  });

  it('enable returns false for unknown id', () => {
    const s = createQueueScheduler();
    expect(s.enable('nope')).toBe(false);
  });

  it('disabled job does not run when due', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { count++; });
    s.disable(id);
    s.start();
    ft.advance(0);
    await flushMicrotasks();
    expect(count).toBe(0);
    await s.stop();
  });
});

// ── 4. runNow ─────────────────────────────────────────────────────────────

describe('runNow', () => {
  it('invokes handler immediately', async () => {
    let called = false;
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 1_000_000 }, () => { called = true; });
    await s.runNow(id);
    expect(called).toBe(true);
  });

  it('increments runCount', async () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 1_000_000 }, () => {});
    await s.runNow(id);
    await s.runNow(id);
    expect(s.get(id)!.runCount).toBe(2);
  });

  it('nextRun recomputed after runNow (interval)', async () => {
    const ft = makeFakeTimers(1000);
    const s = createQueueScheduler({ clock: ft.clock });
    const id = s.add('j', { kind: 'interval', everyMs: 500 }, () => {});
    const before = s.get(id)!.nextRun;
    await s.runNow(id);
    const after = s.get(id)!.nextRun;
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(s.get(id)!.lastRun! + 500);
  });

  it('throws for unknown id', async () => {
    const s = createQueueScheduler();
    await expect(s.runNow('no-id')).rejects.toThrow('"no-id"');
  });

  it('sets lastRun on runNow', async () => {
    const ft = makeFakeTimers(9999);
    const s = createQueueScheduler({ clock: ft.clock });
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    await s.runNow(id);
    expect(s.get(id)!.lastRun).toBe(9999);
  });
});

// ── 5. interval schedule ──────────────────────────────────────────────────

describe('interval schedule', () => {
  it('runs on the first tick (nextRun = now)', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100 }, () => { count++; });
    s.start();
    ft.advance(0);
    await flushMicrotasks();
    expect(count).toBe(1);
    await s.stop();
  });

  it('runs every everyMs milliseconds', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100 }, () => { count++; });
    s.start();

    ft.advance(0); await flushMicrotasks(); // t=0 → count=1
    ft.advance(100); await flushMicrotasks(); // t=100 → count=2
    ft.advance(100); await flushMicrotasks(); // t=200 → count=3

    expect(count).toBe(3);
    await s.stop();
  });

  it('nextRun updates to lastRun + everyMs after each run', async () => {
    const ft = makeFakeTimers(0);
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    const id = s.add('j', { kind: 'interval', everyMs: 250 }, () => {});
    s.start();
    ft.advance(0); await flushMicrotasks();
    expect(s.get(id)!.nextRun).toBe(0 + 250);
    ft.advance(250); await flushMicrotasks();
    expect(s.get(id)!.nextRun).toBe(250 + 250);
    await s.stop();
  });

  it('startAt is respected — no run before startAt', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100, startAt: 5000 }, () => { count++; });
    s.start();
    ft.advance(4999); await flushMicrotasks();
    expect(count).toBe(0);
    ft.advance(1); await flushMicrotasks();  // now t=5000
    expect(count).toBe(1);
    await s.stop();
  });

  it('startAt in the past uses now for first run', async () => {
    const ft = makeFakeTimers(1000);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    // startAt=500 is in the past; nextRun = max(1000, 500) = 1000
    s.add('j', { kind: 'interval', everyMs: 100, startAt: 500 }, () => { count++; });
    s.start();
    ft.advance(0); await flushMicrotasks();
    expect(count).toBe(1);
    await s.stop();
  });
});

// ── 6. oneshot schedule ───────────────────────────────────────────────────

describe('oneshot schedule', () => {
  it('runs once at runAt and is then disabled', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    const id = s.add('j', { kind: 'oneshot', runAt: 500 }, () => { count++; });
    s.start();
    ft.advance(500); await flushMicrotasks();
    expect(count).toBe(1);
    expect(s.get(id)!.enabled).toBe(false);
    // Advancing further should not trigger another run
    ft.advance(500); await flushMicrotasks();
    expect(count).toBe(1);
    await s.stop();
  });

  it('oneshot runCount increments to 1', async () => {
    const ft = makeFakeTimers(0);
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    const id = s.add('j', { kind: 'oneshot', runAt: 100 }, () => {});
    s.start();
    ft.advance(100); await flushMicrotasks();
    expect(s.get(id)!.runCount).toBe(1);
    await s.stop();
  });

  it('oneshot via runNow runs and disables', async () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'oneshot', runAt: 99999 }, () => {});
    await s.runNow(id);
    expect(s.get(id)!.runCount).toBe(1);
    expect(s.get(id)!.enabled).toBe(false);
  });
});

// ── 7. cron schedule ──────────────────────────────────────────────────────

describe('cron schedule', () => {
  it('uses injected cronNextRun to compute initial nextRun', () => {
    const ft = makeFakeTimers(1000);
    const cronCalls: Array<[string, number]> = [];
    const cronNextRun = (expr: string, after: number) => {
      cronCalls.push([expr, after]);
      return after + 60_000;
    };
    const s = createQueueScheduler({ clock: ft.clock, cronNextRun });
    const id = s.add('cj', { kind: 'cron', expr: '* * * * *' }, () => {});
    expect(cronCalls.length).toBeGreaterThanOrEqual(1);
    expect(cronCalls[0]![0]).toBe('* * * * *');
    expect(s.get(id)!.nextRun).toBe(1000 + 60_000);
  });

  it('cronNextRun called again after each run', async () => {
    const ft = makeFakeTimers(0);
    let cronCallCount = 0;
    const cronNextRun = (_expr: string, after: number) => {
      cronCallCount++;
      return after + 60_000;
    };
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer, cronNextRun });
    const initialCalls = cronCallCount;
    s.add('cj', { kind: 'cron', expr: '* * * * *' }, () => {});
    s.start();
    // advance to first nextRun = 60000
    ft.advance(60_000); await flushMicrotasks();
    expect(cronCallCount).toBeGreaterThan(initialCalls + 1);
    await s.stop();
  });

  it('cron nextRun is recomputed using current time after run', async () => {
    const ft = makeFakeTimers(0);
    const cronNextRun = (_expr: string, after: number) => after + 60_000;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer, cronNextRun });
    const id = s.add('cj', { kind: 'cron', expr: '* * * * *' }, () => {});
    s.start();
    ft.advance(60_000); await flushMicrotasks();
    // After run at t=60000, next = cronNextRun('...', 60000) = 120000
    expect(s.get(id)!.nextRun).toBe(120_000);
    await s.stop();
  });
});

// ── 8. error handling ─────────────────────────────────────────────────────

describe('error handling', () => {
  it('failureCount increments when handler throws', async () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { throw new Error('boom'); });
    await s.runNow(id);
    expect(s.get(id)!.failureCount).toBe(1);
  });

  it('lastError is set on handler failure', async () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { throw new Error('oh no'); });
    await s.runNow(id);
    expect(s.get(id)!.lastError).toBe('oh no');
  });

  it('onError callback is invoked with error and job', async () => {
    const errors: Array<[Error, ScheduledJob]> = [];
    const s = createQueueScheduler({ onError: (err, job) => errors.push([err, job]) });
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { throw new Error('fail'); });
    await s.runNow(id);
    expect(errors).toHaveLength(1);
    expect(errors[0]![0].message).toBe('fail');
    expect(errors[0]![1].id).toBe(id);
  });

  it('runCount still increments on error', async () => {
    const s = createQueueScheduler();
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { throw new Error('x'); });
    await s.runNow(id);
    expect(s.get(id)!.runCount).toBe(1);
  });

  it('scheduling continues after a handler error', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({
      clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer,
      onError: () => { /* swallow */ },
    });
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => {
      count++;
      throw new Error('err');
    });
    s.start();
    ft.advance(0); await flushMicrotasks();
    expect(s.get(id)!.failureCount).toBe(1);
    // nextRun should be updated even after error
    const nr = s.get(id)!.nextRun;
    expect(nr).toBeGreaterThan(0);
    ft.advance(100); await flushMicrotasks();
    expect(count).toBe(2);
    await s.stop();
  });

  it('non-Error thrown values are wrapped in Error', async () => {
    const errors: Error[] = [];
    const s = createQueueScheduler({ onError: (err) => errors.push(err) });
    const id = s.add('j', { kind: 'interval', everyMs: 100 }, () => { throw 'string-error'; });
    await s.runNow(id);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(s.get(id)!.lastError).toBe('string-error');
  });
});

// ── 9. maxConcurrent ──────────────────────────────────────────────────────

describe('maxConcurrent', () => {
  it('caps simultaneous running handlers', async () => {
    const ft = makeFakeTimers(0);
    let concurrentPeak = 0;
    let current = 0;
    const resolvers: Array<() => void> = [];

    const s = createQueueScheduler({
      clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer,
      maxConcurrent: 1,
    });

    const makeHandler = () => async () => {
      current++;
      concurrentPeak = Math.max(concurrentPeak, current);
      await new Promise<void>((r) => resolvers.push(r));
      current--;
    };

    s.add('j1', { kind: 'interval', everyMs: 1000 }, makeHandler());
    s.add('j2', { kind: 'interval', everyMs: 1000 }, makeHandler());

    s.start();
    ft.advance(0);
    await flushMicrotasks(3);

    // Only j1 should have started; j2 blocked by cap
    expect(resolvers.length).toBe(1);
    expect(current).toBe(1);

    // Finish j1
    resolvers[0]!();
    await flushMicrotasks(5);

    // j2 should now have started
    expect(resolvers.length).toBe(2);
    expect(concurrentPeak).toBe(1);

    resolvers[1]!();
    await flushMicrotasks(3);
    await s.stop();
  });

  it('queued jobs run when a slot opens', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    let resolver!: () => void;

    const s = createQueueScheduler({
      clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer,
      maxConcurrent: 1,
    });

    s.add('blocker', { kind: 'interval', everyMs: 1000 }, async () => {
      await new Promise<void>((r) => { resolver = r; });
    });
    s.add('waiter', { kind: 'interval', everyMs: 1000 }, () => { count++; });

    s.start();
    ft.advance(0);
    await flushMicrotasks(3);
    expect(count).toBe(0);

    resolver();
    await flushMicrotasks(5);
    expect(count).toBe(1);
    await s.stop();
  });
});

// ── 10. start / stop lifecycle ────────────────────────────────────────────

describe('start / stop lifecycle', () => {
  it('stop waits for in-flight handlers to complete', async () => {
    const ft = makeFakeTimers(0);
    let finished = false;
    let resolver!: () => void;

    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100 }, async () => {
      await new Promise<void>((r) => { resolver = r; });
      finished = true;
    });

    s.start();
    ft.advance(0);
    await flushMicrotasks(3);

    const stopPromise = s.stop();
    expect(finished).toBe(false);

    resolver();
    await flushMicrotasks(5);
    await stopPromise;

    expect(finished).toBe(true);
  });

  it('no new runs after stop()', async () => {
    const ft = makeFakeTimers(0);
    let count = 0;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100 }, () => { count++; });
    s.start();
    ft.advance(0); await flushMicrotasks();
    await s.stop();
    const snapshot = count;
    ft.advance(100); await flushMicrotasks();
    expect(count).toBe(snapshot);
  });

  it('start/stop is idempotent for stats', async () => {
    const s = createQueueScheduler();
    s.start();
    await s.stop();
    expect(s.getStats().total).toBe(0);
  });
});

// ── 11. getStats ──────────────────────────────────────────────────────────

describe('getStats', () => {
  it('counts total, enabled, totalRuns, totalFailures correctly', async () => {
    const s = createQueueScheduler({ onError: () => {} });
    const id1 = s.add('j1', { kind: 'interval', everyMs: 100 }, () => {});
    const id2 = s.add('j2', { kind: 'interval', everyMs: 100 }, () => { throw new Error('!'); });
    const id3 = s.add('j3', { kind: 'interval', everyMs: 100 }, () => {});
    s.disable(id3);

    await s.runNow(id1);
    await s.runNow(id1);
    await s.runNow(id2);

    const stats = s.getStats();
    expect(stats.total).toBe(3);
    expect(stats.enabled).toBe(2); // id3 disabled
    expect(stats.totalRuns).toBe(3);
    expect(stats.totalFailures).toBe(1);
    expect(stats.running).toBe(0);
  });

  it('running count reflects in-flight jobs', async () => {
    const ft = makeFakeTimers(0);
    let resolver!: () => void;
    const s = createQueueScheduler({ clock: ft.clock, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
    s.add('j', { kind: 'interval', everyMs: 100 }, async () => {
      await new Promise<void>((r) => { resolver = r; });
    });
    s.start();
    ft.advance(0);
    await flushMicrotasks(3);
    expect(s.getStats().running).toBe(1);
    resolver();
    await flushMicrotasks(3);
    expect(s.getStats().running).toBe(0);
    await s.stop();
  });
});

// ── 12. persistence ───────────────────────────────────────────────────────

describe('persistence', () => {
  it('save writes a valid JSON file', () => {
    const pp = tmpPath();
    const s = createQueueScheduler({ persistPath: pp });
    s.add('j', { kind: 'interval', everyMs: 100 }, () => {}, { k: 1 });
    s.save();
    expect(existsSync(pp)).toBe(true);
    const raw = require('node:fs').readFileSync(pp, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.jobs).toHaveLength(1);
  });

  it('save omits the handler function', () => {
    const pp = tmpPath();
    const s = createQueueScheduler({ persistPath: pp });
    s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    s.save();
    const raw = require('node:fs').readFileSync(pp, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.jobs[0]).not.toHaveProperty('handler');
  });

  it('load with missing file is a no-op', () => {
    const s = createQueueScheduler({ persistPath: tmpPath() });
    expect(() => s.load(() => () => {})).not.toThrow();
    expect(s.list()).toHaveLength(0);
  });

  it('save + load roundtrip via handlerFactory restores jobs', () => {
    const pp = tmpPath();
    const s1 = createQueueScheduler({ persistPath: pp });
    const id = s1.add('my-job', { kind: 'interval', everyMs: 500 }, () => {}, { tag: 'x' });
    s1.save();

    const s2 = createQueueScheduler({ persistPath: pp });
    s2.load((_job) => () => {});
    const restored = s2.list();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(id);
    expect(restored[0]!.name).toBe('my-job');
    expect(restored[0]!.meta).toEqual({ tag: 'x' });
  });

  it('load reattaches handlers via handlerFactory', async () => {
    const pp = tmpPath();
    const s1 = createQueueScheduler({ persistPath: pp });
    s1.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    s1.save();

    let called = false;
    const s2 = createQueueScheduler({ persistPath: pp });
    s2.load((_job) => () => { called = true; });
    const jobs = s2.list();
    await s2.runNow(jobs[0]!.id);
    expect(called).toBe(true);
  });

  it('persistence format has version 1', () => {
    const pp = tmpPath();
    const s = createQueueScheduler({ persistPath: pp });
    s.add('v', { kind: 'oneshot', runAt: 9999 }, () => {});
    s.save();
    const raw = require('node:fs').readFileSync(pp, 'utf8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('save is a no-op when persistPath is not set', () => {
    const s = createQueueScheduler(); // no persistPath
    s.add('j', { kind: 'interval', everyMs: 100 }, () => {});
    expect(() => s.save()).not.toThrow();
  });

  it('runCount and failureCount are preserved across save/load', async () => {
    const pp = tmpPath();
    const s1 = createQueueScheduler({ persistPath: pp, onError: () => {} });
    const id = s1.add('j', { kind: 'interval', everyMs: 100 }, () => { throw new Error('!'); });
    await s1.runNow(id);
    s1.save();

    const s2 = createQueueScheduler({ persistPath: pp });
    s2.load((_job) => () => {});
    const job = s2.list()[0]!;
    expect(job.runCount).toBe(1);
    expect(job.failureCount).toBe(1);
  });
});
