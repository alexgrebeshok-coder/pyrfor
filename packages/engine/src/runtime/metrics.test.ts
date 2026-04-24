// @vitest-environment node
/**
 * Tests for runtime metrics — formatMetrics, escapeLabel, collectMetrics.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  escapeLabel,
  collectMetrics,
  formatMetrics,
  type MetricsSnapshot,
  type CollectMetricsDeps,
} from './metrics';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<MetricsSnapshot>): MetricsSnapshot {
  return {
    uptimeSeconds: 42.5,
    startedAtTs: '2024-01-01T00:00:00.000Z',
    health: [],
    cronJobs: [],
    cronJobsRegistered: 0,
    sessionsActive: null,
    messagesHandledTotal: null,
    ...overrides,
  };
}

// ─── escapeLabel ───────────────────────────────────────────────────────────

describe('escapeLabel', () => {
  it('passes through plain strings unchanged', () => {
    expect(escapeLabel('database')).toBe('database');
    expect(escapeLabel('my-job_01')).toBe('my-job_01');
  });

  it('escapes backslashes', () => {
    expect(escapeLabel('a\\b')).toBe('a\\\\b');
  });

  it('escapes double quotes', () => {
    expect(escapeLabel('a"b')).toBe('a\\"b');
  });

  it('escapes newlines', () => {
    expect(escapeLabel('a\nb')).toBe('a\\nb');
  });

  it('escapes all special chars together', () => {
    expect(escapeLabel('x\\"y\nz')).toBe('x\\\\\\"y\\nz');
  });
});

// ─── formatMetrics ─────────────────────────────────────────────────────────

describe('formatMetrics', () => {
  it('always emits uptime and started-at blocks', () => {
    const out = formatMetrics(makeSnapshot());
    expect(out).toContain('# HELP pyrfor_runtime_uptime_seconds');
    expect(out).toContain('# TYPE pyrfor_runtime_uptime_seconds gauge');
    expect(out).toContain('pyrfor_runtime_uptime_seconds 42.5');
    expect(out).toContain('# HELP pyrfor_runtime_started');
    expect(out).toContain('# TYPE pyrfor_runtime_started gauge');
    expect(out).toContain('pyrfor_runtime_started{ts="2024-01-01T00:00:00.000Z"} 1');
  });

  it('always emits cron_jobs_registered (even when 0)', () => {
    const out = formatMetrics(makeSnapshot({ cronJobsRegistered: 0 }));
    expect(out).toContain('pyrfor_cron_jobs_registered 0');
  });

  it('emits health check lines when checks are present', () => {
    const out = formatMetrics(
      makeSnapshot({
        health: [
          { name: 'db', ok: true, consecutiveFailures: 0 },
          { name: 'redis', ok: false, consecutiveFailures: 3 },
        ],
      }),
    );
    expect(out).toContain('# HELP pyrfor_health_check_status');
    expect(out).toContain('# TYPE pyrfor_health_check_status gauge');
    expect(out).toContain('pyrfor_health_check_status{check="db"} 1');
    expect(out).toContain('pyrfor_health_check_status{check="redis"} 0');
    expect(out).toContain('# HELP pyrfor_health_check_consecutive_failures');
    expect(out).toContain('pyrfor_health_check_consecutive_failures{check="db"} 0');
    expect(out).toContain('pyrfor_health_check_consecutive_failures{check="redis"} 3');
  });

  it('omits health blocks when no checks', () => {
    const out = formatMetrics(makeSnapshot({ health: [] }));
    expect(out).not.toContain('pyrfor_health_check_status');
    expect(out).not.toContain('pyrfor_health_check_consecutive_failures');
  });

  it('emits cron job counters when jobs are present', () => {
    const out = formatMetrics(
      makeSnapshot({
        cronJobs: [{ name: 'daily', runsTotal: 10, failuresTotal: 2 }],
        cronJobsRegistered: 1,
      }),
    );
    expect(out).toContain('# HELP pyrfor_cron_job_runs_total');
    expect(out).toContain('# TYPE pyrfor_cron_job_runs_total counter');
    expect(out).toContain('pyrfor_cron_job_runs_total{job="daily"} 10');
    expect(out).toContain('# HELP pyrfor_cron_job_failures_total');
    expect(out).toContain('# TYPE pyrfor_cron_job_failures_total counter');
    expect(out).toContain('pyrfor_cron_job_failures_total{job="daily"} 2');
    expect(out).toContain('pyrfor_cron_jobs_registered 1');
  });

  it('omits cron job run/failure counters when no jobs', () => {
    const out = formatMetrics(makeSnapshot({ cronJobs: [], cronJobsRegistered: 0 }));
    expect(out).not.toContain('pyrfor_cron_job_runs_total');
    expect(out).not.toContain('pyrfor_cron_job_failures_total');
  });

  it('emits sessions_active when not null', () => {
    const out = formatMetrics(makeSnapshot({ sessionsActive: 5 }));
    expect(out).toContain('# HELP pyrfor_sessions_active');
    expect(out).toContain('pyrfor_sessions_active 5');
  });

  it('omits sessions_active when null', () => {
    const out = formatMetrics(makeSnapshot({ sessionsActive: null }));
    expect(out).not.toContain('pyrfor_sessions_active');
  });

  it('emits messages_handled_total when not null', () => {
    const out = formatMetrics(makeSnapshot({ messagesHandledTotal: 99 }));
    expect(out).toContain('pyrfor_messages_handled_total 99');
  });

  it('omits messages_handled_total when null', () => {
    const out = formatMetrics(makeSnapshot({ messagesHandledTotal: null }));
    expect(out).not.toContain('pyrfor_messages_handled_total');
  });

  it('escapes label values in check names', () => {
    const out = formatMetrics(
      makeSnapshot({
        health: [{ name: 'my"check', ok: true, consecutiveFailures: 0 }],
      }),
    );
    expect(out).toContain('pyrfor_health_check_status{check="my\\"check"} 1');
  });

  it('ends with a trailing newline', () => {
    const out = formatMetrics(makeSnapshot());
    expect(out.endsWith('\n')).toBe(true);
  });
});

// ─── collectMetrics ────────────────────────────────────────────────────────

function makeHealthMock(
  checks: Record<string, { healthy: boolean; consecutiveFailures: number }>,
): HealthMonitor {
  return {
    getLastSnapshot: vi.fn().mockReturnValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeMs: 0,
      restartCount: 0,
      checks,
    }),
  } as unknown as HealthMonitor;
}

function makeCronMock(
  jobs: Array<{ name: string; successCount: number; failureCount: number }>,
): CronService {
  return {
    getStatus: vi.fn().mockReturnValue(
      jobs.map((j) => ({
        name: j.name,
        schedule: '* * * * *',
        handler: 'h',
        enabled: true,
        nextRunAt: null,
        lastRunAt: null,
        lastError: null,
        successCount: j.successCount,
        failureCount: j.failureCount,
        isRunning: false,
      })),
    ),
  } as unknown as CronService;
}

function makeRuntimeMock(sessionCount: number): PyrforRuntime {
  return {
    sessions: { count: sessionCount },
  } as unknown as PyrforRuntime;
}

describe('collectMetrics', () => {
  it('returns uptimeSeconds and startedAtTs', () => {
    const snap = collectMetrics({});
    expect(snap.uptimeSeconds).toBeGreaterThan(0);
    expect(snap.startedAtTs).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('collects health check metrics from HealthMonitor', () => {
    const health = makeHealthMock({
      db: { healthy: true, consecutiveFailures: 0 },
      cache: { healthy: false, consecutiveFailures: 4 },
    });
    const snap = collectMetrics({ health });
    expect(snap.health).toHaveLength(2);
    const db = snap.health.find((h) => h.name === 'db')!;
    expect(db.ok).toBe(true);
    expect(db.consecutiveFailures).toBe(0);
    const cache = snap.health.find((h) => h.name === 'cache')!;
    expect(cache.ok).toBe(false);
    expect(cache.consecutiveFailures).toBe(4);
  });

  it('returns empty health array when no HealthMonitor provided', () => {
    const snap = collectMetrics({});
    expect(snap.health).toEqual([]);
  });

  it('returns empty health array when snapshot has no checks', () => {
    const health = {
      getLastSnapshot: vi.fn().mockReturnValue(null),
    } as unknown as HealthMonitor;
    const snap = collectMetrics({ health });
    expect(snap.health).toEqual([]);
  });

  it('collects cron job metrics from CronService', () => {
    const cron = makeCronMock([
      { name: 'daily', successCount: 8, failureCount: 2 },
      { name: 'weekly', successCount: 1, failureCount: 0 },
    ]);
    const snap = collectMetrics({ cron });
    expect(snap.cronJobsRegistered).toBe(2);
    const daily = snap.cronJobs.find((j) => j.name === 'daily')!;
    expect(daily.runsTotal).toBe(10); // 8 + 2
    expect(daily.failuresTotal).toBe(2);
    const weekly = snap.cronJobs.find((j) => j.name === 'weekly')!;
    expect(weekly.runsTotal).toBe(1);
    expect(weekly.failuresTotal).toBe(0);
  });

  it('returns 0 jobs when no CronService provided', () => {
    const snap = collectMetrics({});
    expect(snap.cronJobs).toEqual([]);
    expect(snap.cronJobsRegistered).toBe(0);
  });

  it('collects sessionsActive from runtime.sessions.count', () => {
    const runtime = makeRuntimeMock(7);
    const snap = collectMetrics({ runtime });
    expect(snap.sessionsActive).toBe(7);
  });

  it('sets sessionsActive to null when no runtime provided', () => {
    const snap = collectMetrics({});
    expect(snap.sessionsActive).toBeNull();
  });

  it('sets messagesHandledTotal to null (not tracked)', () => {
    const snap = collectMetrics({ runtime: makeRuntimeMock(0) });
    expect(snap.messagesHandledTotal).toBeNull();
  });

  it('handles all deps provided together', () => {
    const deps: CollectMetricsDeps = {
      runtime: makeRuntimeMock(3),
      health: makeHealthMock({ api: { healthy: true, consecutiveFailures: 0 } }),
      cron: makeCronMock([{ name: 'job1', successCount: 5, failureCount: 1 }]),
    };
    const snap = collectMetrics(deps);
    expect(snap.sessionsActive).toBe(3);
    expect(snap.health).toHaveLength(1);
    expect(snap.cronJobs).toHaveLength(1);
    expect(snap.cronJobsRegistered).toBe(1);
  });
});
