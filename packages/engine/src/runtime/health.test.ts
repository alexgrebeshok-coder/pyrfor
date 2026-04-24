// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthMonitor } from './health';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor({ intervalMs: 50 });
  });

  afterEach(() => {
    monitor.stop();
  });

  // ── addCheck + runChecks ────────────────────────────────────────────────
  it('snapshot contains all registered checks', async () => {
    monitor.addCheck('db', async () => ({ healthy: true }));
    monitor.addCheck('cache', async () => ({ healthy: true }));

    const snap = await monitor.runChecks();
    expect(Object.keys(snap.checks)).toContain('db');
    expect(Object.keys(snap.checks)).toContain('cache');
    expect(snap.status).toBe('healthy');
  });

  // ── aggregate status ────────────────────────────────────────────────────
  it('non-critical failure → degraded', async () => {
    monitor.addCheck('ok', async () => ({ healthy: true }));
    monitor.addCheck('flaky', async () => ({ healthy: false }), { critical: false });

    const snap = await monitor.runChecks();
    expect(snap.status).toBe('degraded');
  });

  it('critical failure → unhealthy', async () => {
    monitor.addCheck('ok', async () => ({ healthy: true }));
    monitor.addCheck('db', async () => ({ healthy: false }), { critical: true });

    const snap = await monitor.runChecks();
    expect(snap.status).toBe('unhealthy');
  });

  it('critical failure dominates non-critical failure', async () => {
    monitor.addCheck('a', async () => ({ healthy: false }), { critical: false });
    monitor.addCheck('b', async () => ({ healthy: false }), { critical: true });

    const snap = await monitor.runChecks();
    expect(snap.status).toBe('unhealthy');
  });

  // ── timeout ─────────────────────────────────────────────────────────────
  it('slow check exceeding timeoutMs → healthy:false with timeout message', async () => {
    monitor.addCheck(
      'slow',
      () => new Promise<never>(() => { /* never resolves */ }),
      { timeoutMs: 20 },
    );

    const snap = await monitor.runChecks();
    const entry = snap.checks['slow'];
    expect(entry.healthy).toBe(false);
    expect(entry.message).toMatch(/timeout/i);
  }, 5_000);

  // ── throw in check ──────────────────────────────────────────────────────
  it('throwing check is caught and marked unhealthy', async () => {
    monitor.addCheck('boom', async () => { throw new Error('kaboom'); });

    const snap = await monitor.runChecks();
    expect(snap.checks['boom'].healthy).toBe(false);
    expect(snap.checks['boom'].message).toBe('kaboom');
  });

  // ── consecutiveFailures ─────────────────────────────────────────────────
  it('consecutiveFailures increments on each failure and resets on success', async () => {
    let fail = true;
    monitor.addCheck('toggle', async () => ({ healthy: !fail }));

    await monitor.runChecks();
    expect(monitor.getLastSnapshot()!.checks['toggle'].consecutiveFailures).toBe(1);

    await monitor.runChecks();
    expect(monitor.getLastSnapshot()!.checks['toggle'].consecutiveFailures).toBe(2);

    fail = false;
    await monitor.runChecks();
    expect(monitor.getLastSnapshot()!.checks['toggle'].consecutiveFailures).toBe(0);
  });

  // ── recordRestart ────────────────────────────────────────────────────────
  it('recordRestart increments restartCount in snapshot', async () => {
    monitor.recordRestart();
    monitor.recordRestart();

    const snap = await monitor.runChecks();
    expect(snap.restartCount).toBe(2);
  });

  // ── start / stop idempotency ─────────────────────────────────────────────
  it('start() is idempotent — double call does not throw', () => {
    monitor.start();
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
  });

  it('stop() is idempotent — double call does not throw', () => {
    monitor.start();
    monitor.stop();
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('isRunning reflects start/stop state', () => {
    expect(monitor.isRunning()).toBe(false);
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('restartCount persists across start/stop cycles', () => {
    monitor.start();
    monitor.recordRestart();
    monitor.stop();
    monitor.start();
    monitor.recordRestart();
    monitor.stop();

    // Access internal via getLastSnapshot after a run
    monitor.runChecks().then((snap) => {
      expect(snap.restartCount).toBe(2);
    });
  });

  // ── periodic firing ──────────────────────────────────────────────────────
  it('start() fires runChecks multiple times within window', async () => {
    let callCount = 0;
    monitor.addCheck('counter', async () => {
      callCount++;
      return { healthy: true };
    });

    monitor.start();
    await new Promise((r) => setTimeout(r, 220));
    monitor.stop();

    // intervalMs=50, 220ms window → expect at least 2 interval ticks
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 5_000);

  // ── getLastSnapshot before any run ──────────────────────────────────────
  it('getLastSnapshot returns null before first run', () => {
    expect(monitor.getLastSnapshot()).toBeNull();
  });

  // ── removeCheck / hasCheck ───────────────────────────────────────────────
  it('removeCheck removes an existing check', () => {
    monitor.addCheck('x', async () => ({ healthy: true }));
    expect(monitor.hasCheck('x')).toBe(true);
    expect(monitor.removeCheck('x')).toBe(true);
    expect(monitor.hasCheck('x')).toBe(false);
  });

  it('removeCheck returns false for unknown check', () => {
    expect(monitor.removeCheck('ghost')).toBe(false);
  });

  // ── duplicate addCheck ───────────────────────────────────────────────────
  it('addCheck with duplicate name overwrites previous check', async () => {
    monitor.addCheck('dup', async () => ({ healthy: false }));
    monitor.addCheck('dup', async () => ({ healthy: true }));

    const snap = await monitor.runChecks();
    expect(snap.checks['dup'].healthy).toBe(true);
  });

  // ── 0 checks → healthy ───────────────────────────────────────────────────
  it('0 checks → aggregate status healthy', async () => {
    const snap = await monitor.runChecks();
    expect(snap.status).toBe('healthy');
  });

  // ── invalid result ────────────────────────────────────────────────────────
  it('check returning invalid object → healthy:false, message:invalid result', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monitor.addCheck('bad', async () => ({ notHealthy: true } as any));
    const snap = await monitor.runChecks();
    expect(snap.checks['bad'].healthy).toBe(false);
    expect(snap.checks['bad'].message).toBe('invalid result');
  });

  // ── latencyMs is set ──────────────────────────────────────────────────────
  it('runChecks populates latencyMs for each check', async () => {
    monitor.addCheck('fast', async () => ({ healthy: true }));
    const snap = await monitor.runChecks();
    expect(typeof snap.checks['fast'].latencyMs).toBe('number');
    expect(snap.checks['fast'].latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ── rejected promise ──────────────────────────────────────────────────────
  it('check returning rejected promise → healthy:false with error message', async () => {
    monitor.addCheck('reject', () => Promise.reject(new Error('connection refused')));
    const snap = await monitor.runChecks();
    expect(snap.checks['reject'].healthy).toBe(false);
    expect(snap.checks['reject'].message).toBe('connection refused');
  });

  it('check rejecting with non-Error value → healthy:false with stringified value', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    monitor.addCheck('reject-str', () => Promise.reject('raw string error'));
    const snap = await monitor.runChecks();
    expect(snap.checks['reject-str'].healthy).toBe(false);
    expect(snap.checks['reject-str'].message).toBe('raw string error');
  });

  // ── synchronous throw ─────────────────────────────────────────────────────
  it('synchronously throwing check → healthy:false with stringified error', async () => {
    monitor.addCheck('sync-throw', () => { throw new Error('sync boom'); });
    const snap = await monitor.runChecks();
    expect(snap.checks['sync-throw'].healthy).toBe(false);
    expect(snap.checks['sync-throw'].message).toBe('sync boom');
  });

  // ── all checks fail ───────────────────────────────────────────────────────
  it('all critical checks failing → status unhealthy', async () => {
    monitor.addCheck('a', async () => ({ healthy: false }), { critical: true });
    monitor.addCheck('b', async () => ({ healthy: false }), { critical: true });
    const snap = await monitor.runChecks();
    expect(snap.status).toBe('unhealthy');
    expect(snap.checks['a'].consecutiveFailures).toBeGreaterThan(0);
    expect(snap.checks['b'].consecutiveFailures).toBeGreaterThan(0);
  });

  it('all non-critical checks failing → status degraded', async () => {
    monitor.addCheck('x', async () => ({ healthy: false }), { critical: false });
    monitor.addCheck('y', async () => ({ healthy: false }), { critical: false });
    const snap = await monitor.runChecks();
    expect(snap.status).toBe('degraded');
  });

  // ── addCheck during running monitor ───────────────────────────────────────
  it('addCheck while monitor is running — next runChecks includes it', async () => {
    monitor.start();
    monitor.addCheck('late', async () => ({ healthy: true }));
    const snap = await monitor.runChecks();
    expect(Object.keys(snap.checks)).toContain('late');
    monitor.stop();
  });

  // ── uptimeMs ──────────────────────────────────────────────────────────────
  it('uptimeMs is 0 before start() is called', async () => {
    const snap = await monitor.runChecks();
    expect(snap.uptimeMs).toBe(0);
  });

  it('uptimeMs is positive after start() + some elapsed time', async () => {
    monitor.start();
    await new Promise((r) => setTimeout(r, 20));
    const snap = await monitor.runChecks();
    expect(snap.uptimeMs).toBeGreaterThan(0);
    monitor.stop();
  });

  it('uptimeMs resets when monitor is restarted', async () => {
    monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();

    monitor.start();
    const snap = await monitor.runChecks();
    // After restart uptimeMs should be small (much less than 30ms from the first run)
    expect(snap.uptimeMs).toBeLessThan(200);
    monitor.stop();
  });

  // ── stop() prevents further timer ticks ──────────────────────────────────
  it('stop() prevents further timer ticks', async () => {
    let callCount = 0;
    monitor.addCheck('tick', async () => {
      callCount++;
      return { healthy: true };
    });

    monitor.start();
    await new Promise((r) => setTimeout(r, 80));
    monitor.stop();
    const countAfterStop = callCount;

    await new Promise((r) => setTimeout(r, 120));
    // No additional ticks after stop
    expect(callCount).toBe(countAfterStop);
  }, 5_000);

  // ── removeCheck during active run state ───────────────────────────────────
  it('removeCheck during running monitor — next snapshot excludes it', async () => {
    monitor.addCheck('transient', async () => ({ healthy: true }));
    monitor.start();

    const snap1 = await monitor.runChecks();
    expect(Object.keys(snap1.checks)).toContain('transient');

    monitor.removeCheck('transient');
    const snap2 = await monitor.runChecks();
    expect(Object.keys(snap2.checks)).not.toContain('transient');

    monitor.stop();
  });

  // ── check timeout uses custom timeoutMs ──────────────────────────────────
  it('timeout message includes the configured ms value', async () => {
    monitor.addCheck(
      'long',
      () => new Promise<never>(() => { /* never */ }),
      { timeoutMs: 15 },
    );
    const snap = await monitor.runChecks();
    expect(snap.checks['long'].message).toContain('15');
  }, 5_000);

  // ── snapshot shape ────────────────────────────────────────────────────────
  it('snapshot has all required top-level fields with correct types', async () => {
    monitor.addCheck('shape', async () => ({ healthy: true }));
    const snap = await monitor.runChecks();

    expect(typeof snap.status).toBe('string');
    expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(snap.status);
    expect(typeof snap.uptimeMs).toBe('number');
    expect(typeof snap.timestamp).toBe('string');
    expect(typeof snap.restartCount).toBe('number');
    expect(snap.checks).toBeDefined();
    expect(typeof snap.checks).toBe('object');
    expect(snap.checks).not.toBeNull();
  });

  it('snapshot.timestamp is a valid ISO-8601 string', async () => {
    const snap = await monitor.runChecks();
    expect(snap.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(new Date(snap.timestamp).getTime())).toBe(false);
  });

  // ── check entry fields in snapshot ───────────────────────────────────────
  it('check entry in snapshot includes name, critical, and consecutiveFailures', async () => {
    monitor.addCheck('entry', async () => ({ healthy: true }), { critical: true });
    const snap = await monitor.runChecks();
    const entry = snap.checks['entry'];

    expect(entry.name).toBe('entry');
    expect(entry.critical).toBe(true);
    expect(typeof entry.consecutiveFailures).toBe('number');
    expect(entry.consecutiveFailures).toBe(0);
  });

  it('lastSuccessAt set after healthy run; lastFailureAt set after failing run', async () => {
    monitor.addCheck('timing', async () => ({ healthy: true }));
    const snap1 = await monitor.runChecks();
    expect(snap1.checks['timing'].lastSuccessAt).toBeDefined();
    expect(snap1.checks['timing'].lastFailureAt).toBeUndefined();

    monitor.removeCheck('timing');
    monitor.addCheck('timing', async () => ({ healthy: false }));
    const snap2 = await monitor.runChecks();
    expect(snap2.checks['timing'].lastFailureAt).toBeDefined();
    expect(snap2.checks['timing'].lastSuccessAt).toBeUndefined();
  });

  // ── synchronous (non-async) passing check ────────────────────────────────
  it('synchronous check returning { healthy: true } works without async', async () => {
    monitor.addCheck('sync-pass', () => ({ healthy: true }));
    const snap = await monitor.runChecks();
    expect(snap.checks['sync-pass'].healthy).toBe(true);
    expect(snap.status).toBe('healthy');
  });

  // ── async check properly awaited ─────────────────────────────────────────
  it('async check with deliberate delay is fully awaited before snapshot returns', async () => {
    let resolved = false;
    monitor.addCheck('async-delay', async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      resolved = true;
      return { healthy: true };
    });

    const snap = await monitor.runChecks();
    expect(resolved).toBe(true);
    expect(snap.checks['async-delay'].healthy).toBe(true);
  });

  // ── concurrent runChecks ──────────────────────────────────────────────────
  it('concurrent runChecks calls each return a valid independent snapshot', async () => {
    monitor.addCheck('concurrent', async () => ({ healthy: true }));

    const [snap1, snap2] = await Promise.all([
      monitor.runChecks(),
      monitor.runChecks(),
    ]);

    expect(snap1.status).toBe('healthy');
    expect(snap2.status).toBe('healthy');
    expect(snap1.checks['concurrent']).toBeDefined();
    expect(snap2.checks['concurrent']).toBeDefined();
    expect(snap1.checks['concurrent'].healthy).toBe(true);
    expect(snap2.checks['concurrent'].healthy).toBe(true);
  });

  // ── explicit status field on result ──────────────────────────────────────
  it('check result with explicit status field is preserved in snapshot entry', async () => {
    monitor.addCheck('with-status', async () => ({
      healthy: true,
      status: 'degraded' as const,
      message: 'running with warnings',
    }));

    const snap = await monitor.runChecks();
    expect(snap.checks['with-status'].status).toBe('degraded');
    expect(snap.checks['with-status'].message).toBe('running with warnings');
  });

  // ── metadata field passes through ────────────────────────────────────────
  it('check result metadata is preserved in snapshot entry', async () => {
    monitor.addCheck('meta', async () => ({
      healthy: true,
      metadata: { version: '1.2.3', region: 'us-east-1' },
    }));

    const snap = await monitor.runChecks();
    expect(snap.checks['meta'].metadata).toEqual({ version: '1.2.3', region: 'us-east-1' });
  });

  // ── hasCheck for non-registered ───────────────────────────────────────────
  it('hasCheck returns false for a name that was never registered', () => {
    expect(monitor.hasCheck('nonexistent')).toBe(false);
  });

  it('hasCheck returns true immediately after addCheck', () => {
    monitor.addCheck('present', async () => ({ healthy: true }));
    expect(monitor.hasCheck('present')).toBe(true);
  });

  // ── uptimeMs grows monotonically ─────────────────────────────────────────
  it('uptimeMs is non-decreasing across successive runChecks calls when running', async () => {
    monitor.start();
    const snap1 = await monitor.runChecks();
    await new Promise<void>((r) => setTimeout(r, 15));
    const snap2 = await monitor.runChecks();
    expect(snap2.uptimeMs).toBeGreaterThanOrEqual(snap1.uptimeMs);
    monitor.stop();
  });

  // ── checks record is empty when no checks registered ─────────────────────
  it('checks record is an empty object when no checks are registered', async () => {
    const snap = await monitor.runChecks();
    expect(Object.keys(snap.checks)).toHaveLength(0);
  });
});
