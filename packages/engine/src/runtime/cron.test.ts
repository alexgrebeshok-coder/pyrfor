/**
 * CronService tests
 *
 * Uses every-second schedule `* * * * * *` for timing tests.
 * Note on parallel triggerJob behaviour:
 *   When serializeManualTriggers=false (default), a second triggerJob while
 *   the first is still executing throws CronServiceError immediately.
 *   When serializeManualTriggers=true the second call is queued.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronService, CronServiceError, type CronJobSpec, type CronExecutionContext } from './cron';

// Silence logger noise during tests.
process.env.LOG_LEVEL = 'silent';

// Helper to sleep for `ms` milliseconds.
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

let svc: CronService;

beforeEach(() => {
  svc = new CronService();
});

afterEach(() => {
  svc.stop();
});

// ─── registerHandler + start + triggerJob ────────────────────────────────────

describe('registerHandler + start + triggerJob', () => {
  it('calls handler with correct ctx', async () => {
    const calls: CronExecutionContext[] = [];
    svc.registerHandler('my-handler', async ctx => { calls.push(ctx); });

    const job: CronJobSpec = { name: 'test-job', schedule: '* * * * * *', handler: 'my-handler' };
    svc.start([job]);

    await svc.triggerJob('test-job');

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe('manual');
    expect(calls[0].job.name).toBe('test-job');
    expect(calls[0].firedAt).toBeInstanceOf(Date);
  });
});

// ─── start with unknown handler ──────────────────────────────────────────────

describe('start with unknown handler', () => {
  it('throws CronServiceError listing missing keys', () => {
    expect(() =>
      svc.start([
        { name: 'j1', schedule: '* * * * *', handler: 'missing-a' },
        { name: 'j2', schedule: '* * * * *', handler: 'missing-b' },
      ]),
    ).toThrowError(CronServiceError);

    expect(() =>
      svc.start([{ name: 'j1', schedule: '* * * * *', handler: 'missing-a' }]),
    ).toThrow(/missing-a/i);
  });
});

// ─── addJob after start ───────────────────────────────────────────────────────

describe('addJob after start', () => {
  it('job appears in getStatus with a non-null nextRunAt', () => {
    svc.registerHandler('h', async () => {});
    svc.start([]);

    svc.addJob({ name: 'new-job', schedule: '* * * * * *', handler: 'h' });

    const statuses = svc.getStatus();
    const st = statuses.find(s => s.name === 'new-job');
    expect(st).toBeDefined();
    expect(st!.nextRunAt).not.toBeNull();
  });
});

// ─── removeJob ────────────────────────────────────────────────────────────────

describe('removeJob', () => {
  it('removes job from getStatus', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'removable', schedule: '* * * * *', handler: 'h' }]);

    expect(svc.removeJob('removable')).toBe(true);
    expect(svc.getStatus().find(s => s.name === 'removable')).toBeUndefined();
  });

  it('returns false for non-existing job', () => {
    svc.start([]);
    expect(svc.removeJob('ghost')).toBe(false);
  });
});

// ─── triggerJob success / failure counters ────────────────────────────────────

describe('triggerJob counters', () => {
  it('success path: successCount=1, lastError=null', async () => {
    svc.registerHandler('ok', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'ok' }]);

    await svc.triggerJob('j');

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.successCount).toBe(1);
    expect(st.failureCount).toBe(0);
    expect(st.lastError).toBeNull();
    expect(st.lastRunAt).not.toBeNull();
  });

  it('failure path: failureCount=1, lastError set', async () => {
    svc.registerHandler('boom', async () => { throw new Error('oops'); });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'boom' }]);

    await expect(svc.triggerJob('j')).rejects.toThrow('oops');

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.failureCount).toBe(1);
    expect(st.successCount).toBe(0);
    expect(st.lastError).toBe('oops');
  });
});

// ─── Parallel triggerJob (serializeManualTriggers=false) ─────────────────────

describe('parallel triggerJob — default (serializeManualTriggers=false)', () => {
  /**
   * Behaviour: a second triggerJob call while the first is still executing
   * throws CronServiceError immediately, without waiting.
   */
  it('second concurrent trigger throws CronServiceError', async () => {
    let resolve!: () => void;
    const blocker = new Promise<void>(res => { resolve = res; });

    svc.registerHandler('slow', async () => { await blocker; });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'slow' }]);

    // Fire first trigger (don't await yet).
    const first = svc.triggerJob('j');

    // Yield so the handler starts executing.
    await sleep(10);

    // Second trigger should throw immediately.
    await expect(svc.triggerJob('j')).rejects.toThrow(CronServiceError);

    resolve();
    await first;
  });
});

// ─── Parallel triggerJob (serializeManualTriggers=true) ──────────────────────

describe('parallel triggerJob — serializeManualTriggers=true', () => {
  it('second trigger is queued and runs after first completes', async () => {
    const svcS = new CronService({ serializeManualTriggers: true });
    afterEach(() => svcS.stop());

    const order: number[] = [];
    let resolve!: () => void;
    const blocker = new Promise<void>(res => { resolve = res; });

    svcS.registerHandler('serial', async () => {
      if (order.length === 0) {
        await blocker;
      }
      order.push(order.length + 1);
    });
    svcS.start([{ name: 'j', schedule: '* * * * *', handler: 'serial' }]);

    const first = svcS.triggerJob('j');
    await sleep(10); // let first start

    const second = svcS.triggerJob('j'); // queued

    resolve();
    await Promise.all([first, second]);

    expect(order).toEqual([1, 2]);
    svcS.stop();
  });
});

// ─── stop() prevents further scheduled executions ────────────────────────────

describe('stop()', () => {
  it('handler is not called after stop()', async () => {
    let callCount = 0;
    svc.registerHandler('counter', async () => { callCount++; });
    svc.start([{ name: 'ticker', schedule: '* * * * * *', handler: 'counter' }]);

    svc.stop();

    // Wait longer than one scheduled tick.
    await sleep(1500);

    expect(callCount).toBe(0);
  });
});

// ─── isRunning ────────────────────────────────────────────────────────────────

describe('isRunning()', () => {
  it('reflects lifecycle', () => {
    expect(svc.isRunning()).toBe(false);
    svc.registerHandler('h', async () => {});
    svc.start([]);
    expect(svc.isRunning()).toBe(true);
    svc.stop();
    expect(svc.isRunning()).toBe(false);
  });
});

// ─── Invalid cron expression ─────────────────────────────────────────────────

describe('invalid cron expression', () => {
  it('start() throws CronServiceError', () => {
    svc.registerHandler('h', async () => {});
    expect(() =>
      svc.start([{ name: 'bad', schedule: 'NOT_A_CRON', handler: 'h' }]),
    ).toThrow(CronServiceError);
  });

  it('addJob() throws CronServiceError', () => {
    svc.registerHandler('h', async () => {});
    svc.start([]);
    expect(() =>
      svc.addJob({ name: 'bad', schedule: 'NOT_A_CRON', handler: 'h' }),
    ).toThrow(CronServiceError);
  });
});

// ─── triggerJob for missing job ───────────────────────────────────────────────

describe('triggerJob missing job', () => {
  it('throws CronServiceError', async () => {
    svc.start([]);
    await expect(svc.triggerJob('ghost')).rejects.toThrow(CronServiceError);
  });
});

// ─── start idempotency ────────────────────────────────────────────────────────

describe('start idempotency', () => {
  it('second start with same jobs does not duplicate', () => {
    svc.registerHandler('h', async () => {});
    const jobs: CronJobSpec[] = [{ name: 'j', schedule: '* * * * *', handler: 'h' }];
    svc.start(jobs);
    svc.start(jobs); // second call — should not throw or duplicate
    expect(svc.getStatus()).toHaveLength(1);
  });
});

// ─── process.exit safety (no hanging timers) ─────────────────────────────────
// croner uses unref() internally, so after stop() no timers keep the process alive.
// This test verifies stop() completes synchronously and leaves no observable state.
describe('no hanging timers after stop()', () => {
  it('stop() clears all jobs synchronously', () => {
    svc.registerHandler('h', async () => {});
    svc.start([
      { name: 'j1', schedule: '* * * * * *', handler: 'h' },
      { name: 'j2', schedule: '* * * * * *', handler: 'h' },
    ]);
    expect(svc.getStatus()).toHaveLength(2);

    svc.stop();

    expect(svc.getStatus()).toHaveLength(0);
    expect(svc.isRunning()).toBe(false);
  });
});
