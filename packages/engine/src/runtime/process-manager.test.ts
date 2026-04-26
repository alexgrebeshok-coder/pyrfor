/**
 * Tests for ProcessManager (process-manager.ts)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ProcessManager } from './process-manager';

// Helper: sleep
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('ProcessManager', () => {
  // Each test gets its own isolated instance
  let pm: ProcessManager;

  afterEach(() => {
    // Kill any survivors from the test
    if (pm) {
      pm.cleanup();
    }
  });

  it('spawn → poll: process exits with code 0 and stdout captured', async () => {
    pm = new ProcessManager();
    const sentinel = '__hello_pyrfor_test__';
    const { pid } = pm.spawn({
      command: 'node',
      args: ['-e', `console.log('${sentinel}')`],
    });
    expect(pid).toBeGreaterThan(0);

    // Wait for exit
    await vi.waitFor(
      () => {
        const result = pm.poll(pid);
        if (result.status !== 'exited') throw new Error('not yet exited');
        return result;
      },
      { timeout: 5000, interval: 100 }
    );

    const result = pm.poll(pid);
    expect(result.status).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail.join('\n')).toContain(sentinel);
  });

  it('spawn → list shows running → kill → poll shows killed', async () => {
    pm = new ProcessManager();
    const { pid } = pm.spawn({
      command: 'node',
      args: ['-e', "setInterval(() => {}, 1000)"],
    });

    // Give it a moment to start
    await sleep(100);

    const listed = pm.list();
    expect(listed.some((e) => e.pid === pid && e.status === 'running')).toBe(true);

    const killResult = pm.kill(pid);
    expect(killResult.killed).toBe(true);
    expect(killResult.signal).toBe('SIGTERM');

    // After kill the status should be marked immediately
    const polled = pm.poll(pid);
    expect(polled.status).toBe('killed');
  });

  it('spawn with timeout=1s: process gets timeout status after ~1s', async () => {
    pm = new ProcessManager({ defaultTimeoutMs: 60_000 }); // high default to not interfere
    const { pid } = pm.spawn({
      command: 'node',
      args: ['-e', "setInterval(() => {}, 1000)"],
      timeoutSec: 1, // 1 second timeout
    });

    // Wait 1.5 seconds
    await sleep(1500);

    const result = pm.poll(pid);
    expect(result.status).toBe('timeout');
  });

  it('buffer cap: process that prints 2000 lines — poll tail=50 returns ≤50 lines', async () => {
    pm = new ProcessManager({ maxBufferLines: 1000 });
    const { pid } = pm.spawn({
     command: 'node',
     args: [
       '-e',
        `const lines = Array.from({ length: 2000 }, (_, i) => 'line-' + i).join('\\n') + '\\n'; process.stdout.write(lines, () => process.exit(0));`,
      ],
    });

    // Wait for exit
    await vi.waitFor(
      () => {
        const r = pm.poll(pid);
        if (r.status !== 'exited') throw new Error('not yet exited');
      },
      { timeout: 10000, interval: 100 }
    );

    const result = pm.poll(pid, 50);
    expect(result.stdoutTail.length).toBe(50);
    // Should be the LAST 50 lines
    expect(result.stdoutTail[result.stdoutTail.length - 1]).toContain('line-1999');
  });

  it('cleanup() kills running processes', async () => {
    pm = new ProcessManager();
    const { pid } = pm.spawn({
      command: 'node',
      args: ['-e', "setInterval(() => {}, 1000)"],
    });

    await sleep(100);

    // Verify it's running
    expect(pm.poll(pid).status).toBe('running');

    pm.cleanup();

    // After cleanup, map is cleared — pid should throw
    expect(() => pm.poll(pid)).toThrow(`Unknown PID: ${pid}`);
  });

  it('poll on unknown PID throws', () => {
    pm = new ProcessManager();
    expect(() => pm.poll(999999)).toThrow('Unknown PID: 999999');
  });

  it('kill on unknown PID returns killed=false', () => {
    pm = new ProcessManager();
    const result = pm.kill(999999);
    expect(result.killed).toBe(false);
    expect(result.pid).toBe(999999);
  });
});
