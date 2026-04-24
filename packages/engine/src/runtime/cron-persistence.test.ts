// @vitest-environment node
/**
 * CronPersistenceStore tests
 *
 * Covers: upsert/get/list/remove, enable/disable, recordRun, recordSkipped,
 * setNextRun, stats, flush (atomic + debounced), reload, malformed JSON,
 * concurrent flush coalescing, and reset.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCronPersistenceStore } from './cron-persistence.js';
import os from 'os';
import path from 'path';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';

// ── helpers ────────────────────────────────────────────────────────────────

const activePaths: string[] = [];

function tmpPath(): string {
  const p = path.join(
    os.tmpdir(),
    `cron-persist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  activePaths.push(p);
  return p;
}

afterEach(() => {
  vi.useRealTimers();
  for (const p of activePaths) {
    try {
      rmSync(p, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
  activePaths.length = 0;
});

// ── 1. upsert creates with defaults ───────────────────────────────────────

describe('upsert', () => {
  it('creates a new job with defaults when id is omitted', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h1' });

    expect(job.id).toBeTruthy();
    expect(job.name).toBe('test');
    expect(job.cron).toBe('* * * * *');
    expect(job.handler).toBe('h1');
    expect(job.enabled).toBe(true);
    expect(job.totalRuns).toBe(0);
    expect(job.totalSuccesses).toBe(0);
    expect(job.consecutiveFailures).toBe(0);
    expect(job.createdAt).toBeTruthy();
    expect(job.updatedAt).toBeTruthy();
    expect(job.lastRunAt).toBeUndefined();
  });

  it('updates existing job and merges (preserves counters/lastRun)', () => {
    const store = createCronPersistenceStore();
    const original = store.upsert({ id: 'abc', name: 'first', cron: '* * * * *', handler: 'h1' });
    store.recordRun('abc', { ok: true, durationMs: 10 });
    store.recordRun('abc', { ok: false, durationMs: 10, error: 'oops' });

    const updated = store.upsert({ id: 'abc', name: 'updated', cron: '0 * * * *', handler: 'h2' });

    expect(updated.id).toBe('abc');
    expect(updated.name).toBe('updated');
    expect(updated.cron).toBe('0 * * * *');
    expect(updated.handler).toBe('h2');
    // Counters and last-run state preserved
    expect(updated.totalRuns).toBe(2);
    expect(updated.totalSuccesses).toBe(1);
    expect(updated.consecutiveFailures).toBe(1);
    expect(updated.createdAt).toBe(original.createdAt);
  });
});

// ── 3. list ────────────────────────────────────────────────────────────────

describe('list', () => {
  it('returns all jobs when no filter is given', () => {
    const store = createCronPersistenceStore();
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h' });
    expect(store.list()).toHaveLength(2);
    expect(store.list({})).toHaveLength(2);
  });

  it('filters by enabled=true', () => {
    const store = createCronPersistenceStore();
    const j1 = store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h', enabled: true });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h', enabled: false });

    const enabled = store.list({ enabled: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe(j1.id);
  });

  it('filters by enabled=false (disabled only)', () => {
    const store = createCronPersistenceStore();
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h', enabled: true });
    const j2 = store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h', enabled: false });

    const disabled = store.list({ enabled: false });
    expect(disabled).toHaveLength(1);
    expect(disabled[0].id).toBe(j2.id);
  });

  it('filters by handler', () => {
    const store = createCronPersistenceStore();
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'alpha' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'beta' });
    store.upsert({ name: 'j3', cron: '* * * * *', handler: 'alpha' });

    const alphaJobs = store.list({ handler: 'alpha' });
    expect(alphaJobs).toHaveLength(2);
    expect(alphaJobs.every((j) => j.handler === 'alpha')).toBe(true);
  });

  it('filters by ownerChatId', () => {
    const store = createCronPersistenceStore();
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h', ownerChatId: 'chat-1' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h', ownerChatId: 'chat-2' });
    store.upsert({ name: 'j3', cron: '* * * * *', handler: 'h', ownerChatId: 'chat-1' });

    const chat1 = store.list({ ownerChatId: 'chat-1' });
    expect(chat1).toHaveLength(2);
    expect(chat1.every((j) => j.ownerChatId === 'chat-1')).toBe(true);
  });
});

// ── 7. get / 8. remove ────────────────────────────────────────────────────

describe('get / remove', () => {
  it('get returns job by id; undefined for missing', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });
    expect(store.get(job.id)).toEqual(job);
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('remove returns true and drops the job', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });
    expect(store.remove(job.id)).toBe(true);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.remove(job.id)).toBe(false); // idempotent
  });

  it('listing after remove omits removed job', () => {
    const store = createCronPersistenceStore();
    const j1 = store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h' });
    store.remove(j1.id);

    const jobs = store.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('j2');
  });
});

// ── 9–11. enable / disable ────────────────────────────────────────────────

describe('enable / disable', () => {
  it('enable flips job to enabled=true', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h', enabled: false });
    expect(store.enable(job.id)).toBe(true);
    expect(store.get(job.id)!.enabled).toBe(true);
  });

  it('disable flips job to enabled=false', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h', enabled: true });
    expect(store.disable(job.id)).toBe(true);
    expect(store.get(job.id)!.enabled).toBe(false);
  });

  it('enable/disable missing id returns false', () => {
    const store = createCronPersistenceStore();
    expect(store.enable('ghost')).toBe(false);
    expect(store.disable('ghost')).toBe(false);
  });
});

// ── 12–16. recordRun ──────────────────────────────────────────────────────

describe('recordRun', () => {
  it('success increments totalSuccesses and resets consecutiveFailures', () => {
    const store = createCronPersistenceStore({ maxConsecutiveFailures: 10 });
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    store.recordRun(job.id, { ok: false, durationMs: 10, error: 'first-err' });
    expect(store.get(job.id)!.consecutiveFailures).toBe(1);

    const result = store.recordRun(job.id, { ok: true, durationMs: 20 });
    expect(result!.totalSuccesses).toBe(1);
    expect(result!.consecutiveFailures).toBe(0);
    expect(result!.lastStatus).toBe('success');
  });

  it('failure increments consecutiveFailures', () => {
    const store = createCronPersistenceStore({ maxConsecutiveFailures: 10 });
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    store.recordRun(job.id, { ok: false, durationMs: 10 });
    store.recordRun(job.id, { ok: false, durationMs: 10 });

    const state = store.get(job.id)!;
    expect(state.consecutiveFailures).toBe(2);
    expect(state.lastStatus).toBe('failure');
  });

  it('stores lastError on failure, clears on next success', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    store.recordRun(job.id, { ok: false, durationMs: 10, error: 'DB is down' });
    expect(store.get(job.id)!.lastError).toBe('DB is down');

    store.recordRun(job.id, { ok: true, durationMs: 5 });
    expect(store.get(job.id)!.lastError).toBeUndefined();
  });

  it('sets lastDurationMs and lastRunAt from ts', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });
    const ts = new Date().toISOString();

    const result = store.recordRun(job.id, { ok: true, durationMs: 42, ts });
    expect(result!.lastDurationMs).toBe(42);
    expect(result!.lastRunAt).toBe(ts);
  });

  it('missing id returns undefined without throwing', () => {
    const store = createCronPersistenceStore();
    expect(store.recordRun('nope', { ok: true, durationMs: 10 })).toBeUndefined();
  });
});

// ── 17–18. auto-disable ───────────────────────────────────────────────────

describe('auto-disable', () => {
  it('disables job after maxConsecutiveFailures and logs warn', () => {
    const warnings: string[] = [];
    const store = createCronPersistenceStore({
      maxConsecutiveFailures: 3,
      logger: (l, m) => {
        if (l === 'warn') warnings.push(m);
      },
    });
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    store.recordRun(job.id, { ok: false, durationMs: 10 });
    store.recordRun(job.id, { ok: false, durationMs: 10 });
    expect(store.get(job.id)!.enabled).toBe(true); // not yet

    store.recordRun(job.id, { ok: false, durationMs: 10 });
    expect(store.get(job.id)!.enabled).toBe(false); // auto-disabled
    expect(warnings.some((w) => w.includes('auto-disabled'))).toBe(true);
  });

  it('maxConsecutiveFailures=0 never auto-disables', () => {
    const store = createCronPersistenceStore({ maxConsecutiveFailures: 0 });
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    for (let i = 0; i < 100; i++) {
      store.recordRun(job.id, { ok: false, durationMs: 10 });
    }

    expect(store.get(job.id)!.enabled).toBe(true);
  });
});

// ── 19. recordSkipped ─────────────────────────────────────────────────────

describe('recordSkipped', () => {
  it('increments totalRuns but does not change consecutiveFailures', () => {
    const store = createCronPersistenceStore({ maxConsecutiveFailures: 3 });
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    store.recordRun(job.id, { ok: false, durationMs: 10 });
    store.recordRun(job.id, { ok: false, durationMs: 10 });
    expect(store.get(job.id)!.consecutiveFailures).toBe(2);

    const after = store.recordSkipped(job.id, 'window-closed');
    expect(after!.totalRuns).toBe(3);
    expect(after!.consecutiveFailures).toBe(2); // unchanged
    expect(after!.lastStatus).toBe('skipped');
    expect(after!.enabled).toBe(true); // not auto-disabled by skipped
  });
});

// ── 20. setNextRun ────────────────────────────────────────────────────────

describe('setNextRun', () => {
  it('updates nextRunAt field and returns true', () => {
    const store = createCronPersistenceStore();
    const job = store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });
    const nextRun = new Date(Date.now() + 60_000).toISOString();

    expect(store.setNextRun(job.id, nextRun)).toBe(true);
    expect(store.get(job.id)!.nextRunAt).toBe(nextRun);
  });

  it('returns false for missing id', () => {
    const store = createCronPersistenceStore();
    expect(store.setNextRun('nope', new Date().toISOString())).toBe(false);
  });
});

// ── 21. stats ─────────────────────────────────────────────────────────────

describe('stats', () => {
  it('aggregates totalJobs, enabledJobs, totalRuns, totalSuccesses, totalFailures, autoDisabledJobs', () => {
    const store = createCronPersistenceStore({ maxConsecutiveFailures: 2 });
    const j1 = store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });
    const j2 = store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h' });

    store.recordRun(j1.id, { ok: true, durationMs: 10 });
    store.recordRun(j1.id, { ok: true, durationMs: 10 });
    store.recordRun(j2.id, { ok: false, durationMs: 10 });
    store.recordRun(j2.id, { ok: false, durationMs: 10 }); // triggers auto-disable

    const s = store.stats();
    expect(s.totalJobs).toBe(2);
    expect(s.enabledJobs).toBe(1); // j2 auto-disabled
    expect(s.totalRuns).toBe(4);
    expect(s.totalSuccesses).toBe(2);
    expect(s.totalFailures).toBe(2); // totalRuns − totalSuccesses
    expect(s.autoDisabledJobs).toBe(1);
  });
});

// ── 22. flush writes JSON atomically ──────────────────────────────────────

describe('flush', () => {
  it('writes JSON to disk', async () => {
    const p = tmpPath();
    const store = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 99_999 });
    store.upsert({ name: 'test', cron: '* * * * *', handler: 'h' });

    await store.flush();

    const written = JSON.parse(readFileSync(p, 'utf8')) as unknown[];
    expect(written).toHaveLength(1);
    expect((written[0] as { name: string }).name).toBe('test');
  });

  it('concurrent flush calls return the same in-flight promise', async () => {
    const p = tmpPath();
    const store = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 99_999 });
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });

    const p1 = store.flush();
    const p2 = store.flush();
    expect(p1).toBe(p2);
    await p1;
  });
});

// ── 23. reload from JSON restores jobs ────────────────────────────────────

describe('persistence', () => {
  it('reload from JSON restores jobs including counters', async () => {
    const p = tmpPath();
    const store1 = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 99_999 });
    const job = store1.upsert({ name: 'persist-test', cron: '* * * * *', handler: 'h' });
    store1.recordRun(job.id, { ok: true, durationMs: 50 });
    store1.recordRun(job.id, { ok: false, durationMs: 30, error: 'boom' });
    await store1.flush();

    const store2 = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 99_999 });
    const restored = store2.get(job.id);

    expect(restored).toBeDefined();
    expect(restored!.name).toBe('persist-test');
    expect(restored!.totalRuns).toBe(2);
    expect(restored!.totalSuccesses).toBe(1);
    expect(restored!.consecutiveFailures).toBe(1);
    expect(restored!.lastError).toBe('boom');
    expect(restored!.lastStatus).toBe('failure');
  });

  it('malformed JSON starts empty and emits a warn', () => {
    const p = tmpPath();
    writeFileSync(p, 'NOT_VALID_JSON{{{', 'utf8');

    const warnings: string[] = [];
    const store = createCronPersistenceStore({
      storePath: p,
      logger: (l, m) => {
        if (l === 'warn') warnings.push(m);
      },
    });

    expect(store.list()).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ── 25. debounced flush coalesces ─────────────────────────────────────────

describe('debounced flush', () => {
  it('multiple upserts within debounce window produce one write (fake timers)', async () => {
    vi.useFakeTimers();
    const p = tmpPath();
    const store = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 200 });

    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h' });
    store.upsert({ name: 'j3', cron: '* * * * *', handler: 'h' });

    // File must not exist yet — debounce hasn't fired.
    expect(existsSync(p)).toBe(false);

    // Advance fake timers — fires the single coalesced debounce callback,
    // which starts the flush (but the native fs/promises I/O is not timer-based).
    await vi.runAllTimersAsync();

    // Switch back to real timers so we can await the in-flight native I/O.
    vi.useRealTimers();
    // store.flush() returns the same in-flight promise if it is still running,
    // or a new (fast) write if it already completed — either way we wait for it.
    await store.flush();

    // Exactly one debounce window → exactly one flush → file has all 3 jobs.
    expect(existsSync(p)).toBe(true);
    const written = JSON.parse(readFileSync(p, 'utf8')) as unknown[];
    expect(written).toHaveLength(3);
  });
});

// ── 26. reset ─────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all jobs in memory and flushes empty state to disk', async () => {
    const p = tmpPath();
    const store = createCronPersistenceStore({ storePath: p, autosaveDebounceMs: 99_999 });
    store.upsert({ name: 'j1', cron: '* * * * *', handler: 'h' });
    store.upsert({ name: 'j2', cron: '* * * * *', handler: 'h' });
    expect(store.list()).toHaveLength(2);

    store.reset();
    expect(store.list()).toHaveLength(0); // in-memory immediately empty

    // Wait for the async flush to complete.
    await store.flush();
    const written = JSON.parse(readFileSync(p, 'utf8')) as unknown[];
    expect(written).toHaveLength(0);
  });
});
