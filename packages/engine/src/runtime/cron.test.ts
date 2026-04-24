// @vitest-environment node
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

// ─── getStatus() shape matches OpenAPI CronJobStatus schema ──────────────────

describe('getStatus() shape', () => {
  it('all required CronJobStatus fields are present with correct types', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'shape-job', schedule: '* * * * *', handler: 'h' }]);

    const statuses = svc.getStatus();
    expect(statuses).toHaveLength(1);
    const st = statuses[0];

    expect(typeof st.name).toBe('string');
    expect(typeof st.schedule).toBe('string');
    expect(typeof st.handler).toBe('string');
    expect(typeof st.enabled).toBe('boolean');
    expect(st.nextRunAt === null || typeof st.nextRunAt === 'string').toBe(true);
    expect(st.lastRunAt === null || typeof st.lastRunAt === 'string').toBe(true);
    expect(st.lastError === null || typeof st.lastError === 'string').toBe(true);
    expect(typeof st.successCount).toBe('number');
    expect(typeof st.failureCount).toBe('number');
    expect(st.successCount).toBeGreaterThanOrEqual(0);
    expect(st.failureCount).toBeGreaterThanOrEqual(0);
    expect(typeof st.isRunning).toBe('boolean');
  });

  it('timezone is propagated from job spec', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'tz-job', schedule: '* * * * *', handler: 'h', timezone: 'Europe/Moscow' }]);
    const st = svc.getStatus().find(s => s.name === 'tz-job')!;
    expect(st.timezone).toBe('Europe/Moscow');
  });

  it('defaultTimezone propagates to jobs without explicit timezone', () => {
    const svcTz = new CronService({ defaultTimezone: 'America/New_York' });
    svcTz.registerHandler('h', async () => {});
    svcTz.start([{ name: 'j', schedule: '* * * * *', handler: 'h' }]);
    const st = svcTz.getStatus().find(s => s.name === 'j')!;
    expect(st.timezone).toBe('America/New_York');
    svcTz.stop();
  });
});

// ─── successCount / failureCount across multiple invocations ─────────────────

describe('counter increments across multiple invocations', () => {
  it('successCount increments on each successful run', async () => {
    svc.registerHandler('ok', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'ok' }]);

    await svc.triggerJob('j');
    await svc.triggerJob('j');
    await svc.triggerJob('j');

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.successCount).toBe(3);
    expect(st.failureCount).toBe(0);
  });

  it('failureCount increments on each failed run', async () => {
    svc.registerHandler('boom', async () => { throw new Error('fail'); });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'boom' }]);

    for (let i = 0; i < 3; i++) {
      await expect(svc.triggerJob('j')).rejects.toThrow();
    }

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.failureCount).toBe(3);
    expect(st.successCount).toBe(0);
  });

  it('successCount and failureCount increment independently', async () => {
    let shouldFail = false;
    svc.registerHandler('mixed', async () => { if (shouldFail) throw new Error('fail'); });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'mixed' }]);

    await svc.triggerJob('j');
    await svc.triggerJob('j');

    shouldFail = true;
    await expect(svc.triggerJob('j')).rejects.toThrow();

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.successCount).toBe(2);
    expect(st.failureCount).toBe(1);
  });
});

// ─── stop() idempotency ───────────────────────────────────────────────────────

describe('stop() idempotency', () => {
  it('calling stop() twice does not throw', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'h' }]);
    expect(() => { svc.stop(); svc.stop(); }).not.toThrow();
    expect(svc.isRunning()).toBe(false);
  });

  it('can restart after stop()', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'h' }]);
    svc.stop();
    // start again with different job (stop clears all jobs)
    svc.start([{ name: 'j2', schedule: '* * * * *', handler: 'h' }]);
    expect(svc.isRunning()).toBe(true);
    expect(svc.getStatus()).toHaveLength(1);
    expect(svc.getStatus()[0].name).toBe('j2');
  });
});

// ─── hasHandler / unregisterHandler ──────────────────────────────────────────

describe('hasHandler / unregisterHandler', () => {
  it('hasHandler returns true after register, false after unregister', () => {
    svc.registerHandler('h', async () => {});
    expect(svc.hasHandler('h')).toBe(true);
    expect(svc.unregisterHandler('h')).toBe(true);
    expect(svc.hasHandler('h')).toBe(false);
  });

  it('unregisterHandler returns false for non-existing key', () => {
    expect(svc.unregisterHandler('ghost')).toBe(false);
  });
});

// ─── addJob validation ────────────────────────────────────────────────────────

describe('addJob validation', () => {
  it('throws CronServiceError when job name already exists', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'existing', schedule: '* * * * *', handler: 'h' }]);
    expect(() =>
      svc.addJob({ name: 'existing', schedule: '* * * * *', handler: 'h' })
    ).toThrow(CronServiceError);
  });

  it('throws CronServiceError when handler not registered', () => {
    svc.start([]);
    expect(() =>
      svc.addJob({ name: 'new-job', schedule: '* * * * *', handler: 'unregistered' })
    ).toThrow(CronServiceError);
  });
});

// ─── Handler deregistered before execution ────────────────────────────────────

describe('handler removed before execution', () => {
  it('_execute resolves without throwing when handler vanishes at runtime', async () => {
    svc.registerHandler('ephemeral', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'ephemeral' }]);
    svc.unregisterHandler('ephemeral');

    // triggerJob resolves (handler not found path returns undefined, not throw)
    await expect(svc.triggerJob('j')).resolves.toBeUndefined();

    // Counters stay at 0 — missing handler is not recorded as success or failure
    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.successCount).toBe(0);
    expect(st.failureCount).toBe(0);
  });
});

// ─── Disabled job ─────────────────────────────────────────────────────────────

describe('disabled job (enabled: false)', () => {
  it('appears in getStatus with enabled=false and isRunning=false', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'paused-job', schedule: '* * * * *', handler: 'h', enabled: false }]);
    const st = svc.getStatus().find(s => s.name === 'paused-job')!;
    expect(st).toBeDefined();
    expect(st.enabled).toBe(false);
    expect(st.isRunning).toBe(false);
  });
});

// ─── addJob: error message includes expression and job name ──────────────────

describe('addJob: error message includes expression and job name', () => {
  it('message contains the invalid expression and the job name', () => {
    svc.registerHandler('h', async () => {});
    svc.start([]);

    let caught: unknown;
    try {
      svc.addJob({ name: 'bad-job', schedule: 'NOT-A-CRON', handler: 'h' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CronServiceError);
    const msg = (caught as CronServiceError).message;
    expect(msg).toContain('NOT-A-CRON');
    expect(msg).toContain('bad-job');
  });
});

// ─── timezone: per-job override of defaultTimezone ───────────────────────────

describe('timezone: per-job timezone overrides service defaultTimezone', () => {
  it('explicit job timezone takes precedence over service defaultTimezone', () => {
    const svcTz = new CronService({ defaultTimezone: 'America/New_York' });
    svcTz.registerHandler('h', async () => {});
    svcTz.start([
      { name: 'explicit-tz', schedule: '* * * * *', handler: 'h', timezone: 'Europe/London' },
      { name: 'default-tz', schedule: '* * * * *', handler: 'h' },
    ]);

    const statuses = svcTz.getStatus();
    const explicit = statuses.find(s => s.name === 'explicit-tz')!;
    const withDefault = statuses.find(s => s.name === 'default-tz')!;

    expect(explicit.timezone).toBe('Europe/London');
    expect(withDefault.timezone).toBe('America/New_York');
    svcTz.stop();
  });
});

// ─── fake timers: every-second schedule fires multiple times ─────────────────

describe('fake timers: every-second schedule fires multiple times', () => {
  it('handler is called ≥3 times when fake clock advances 3.5 seconds', async () => {
    vi.useFakeTimers();
    const svcFake = new CronService();
    let callCount = 0;
    svcFake.registerHandler('tick', async () => { callCount++; });
    svcFake.start([{ name: 'fast-job', schedule: '* * * * * *', handler: 'tick' }]);

    try {
      await vi.advanceTimersByTimeAsync(3500);
      expect(callCount).toBeGreaterThanOrEqual(3);
    } finally {
      svcFake.stop();
      vi.useRealTimers();
    }
  });
});

// ─── getStatus: lastRunAt and lastError as ISO strings after runs ─────────────

describe('getStatus: lastRunAt and lastError reflect completed runs', () => {
  it('lastRunAt is a valid ISO string and lastError is null after success', async () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'h' }]);
    await svc.triggerJob('j');

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(typeof st.lastRunAt).toBe('string');
    expect(new Date(st.lastRunAt!).toISOString()).toBe(st.lastRunAt);
    expect(st.lastError).toBeNull();
  });

  it('lastRunAt and lastError are both set after a failing run', async () => {
    svc.registerHandler('boom', async () => { throw new Error('test-boom'); });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'boom' }]);
    await expect(svc.triggerJob('j')).rejects.toThrow();

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(typeof st.lastRunAt).toBe('string');
    expect(new Date(st.lastRunAt!).toISOString()).toBe(st.lastRunAt);
    expect(st.lastError).toBe('test-boom');
  });
});

// ─── handler rejects with non-Error value ────────────────────────────────────

describe('handler rejects with non-Error value', () => {
  it('string rejection: failureCount increments and lastError is the string', async () => {
    svc.registerHandler('str-throw', async () => { throw 'plain string error'; });
    svc.start([{ name: 'j', schedule: '* * * * *', handler: 'str-throw' }]);

    await expect(svc.triggerJob('j')).rejects.toBe('plain string error');

    const st = svc.getStatus().find(s => s.name === 'j')!;
    expect(st.failureCount).toBe(1);
    expect(st.successCount).toBe(0);
    expect(st.lastError).toBe('plain string error');
  });

  it('number rejection: failureCount increments and lastError is stringified number', async () => {
    svc.registerHandler('num-throw', async () => { throw 404; });
    svc.start([{ name: 'j2', schedule: '* * * * *', handler: 'num-throw' }]);

    await expect(svc.triggerJob('j2')).rejects.toBe(404);

    const st = svc.getStatus().find(s => s.name === 'j2')!;
    expect(st.failureCount).toBe(1);
    expect(st.lastError).toBe('404');
  });
});

// ─── stop() during mid-execution ─────────────────────────────────────────────

describe('stop() during mid-execution', () => {
  it('current run completes gracefully; no new triggers fire after stop', async () => {
    let completed = false;
    let callCount = 0;
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>(res => { resolveBlocker = res; });

    svc.registerHandler('slow', async () => {
      callCount++;
      await blocker;
      completed = true;
    });
    svc.start([{ name: 'j', schedule: '* * * * * *', handler: 'slow' }]);

    const triggered = svc.triggerJob('j');
    await sleep(10); // yield so the handler starts executing

    // Stop while handler is awaiting the blocker
    svc.stop();
    expect(svc.isRunning()).toBe(false);
    expect(completed).toBe(false); // handler still mid-flight

    // Unblock the handler — it should complete normally
    resolveBlocker();
    await triggered;

    expect(completed).toBe(true);
    expect(callCount).toBe(1);

    // Verify no additional triggers fire after stop
    await sleep(1200);
    expect(callCount).toBe(1);
  });
});

// ─── dispose/cleanup: no leaked handles after stop ───────────────────────────

describe('dispose/cleanup: after stop() job names can be reused', () => {
  it('same job name can be added after stop() clears internal state', () => {
    svc.registerHandler('h', async () => {});
    svc.start([{ name: 'reusable', schedule: '* * * * *', handler: 'h' }]);
    expect(svc.getStatus()).toHaveLength(1);

    svc.stop();

    // stop() clears jobs; the same name must be addable now
    svc.start([]);
    expect(() =>
      svc.addJob({ name: 'reusable', schedule: '* * * * *', handler: 'h' })
    ).not.toThrow();
    expect(svc.getStatus().find(s => s.name === 'reusable')).toBeDefined();
  });
});
