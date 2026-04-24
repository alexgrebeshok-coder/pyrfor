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
});
