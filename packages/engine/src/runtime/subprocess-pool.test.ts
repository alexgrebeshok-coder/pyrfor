// @vitest-environment node
/**
 * subprocess-pool.test.ts
 *
 * Two test categories:
 *   A) "real-spawn" tests — use a tiny Node echo-worker written to os.tmpdir().
 *   B) "fake-spawn" tests — FakeChild EventEmitter + fake timers for determinism.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { spawn as realSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createSubprocessPool,
  type PoolResult,
  type PoolFailure,
} from './subprocess-pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Echo-worker script (written once to tmpdir)
// ─────────────────────────────────────────────────────────────────────────────

let scriptPath: string;

beforeAll(() => {
  scriptPath = path.join(os.tmpdir(), `echo-worker-${process.pid}.mjs`);
  fs.writeFileSync(
    scriptPath,
    `
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.payload?.crash) process.exit(7);
    if (m.payload?.sleepMs) {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({id:m.id,ok:true,data:m.payload})+'\\n');
      }, m.payload.sleepMs);
      continue;
    }
    process.stdout.write(JSON.stringify({id:m.id,ok:true,data:m.payload})+'\\n');
  }
});
`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FakeChild infrastructure
// ─────────────────────────────────────────────────────────────────────────────

interface FakeChild {
  proc: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write(d: string): void; end(): void };
    kill(sig?: string): boolean;
    killed: boolean;
    once(event: string, cb: (...args: unknown[]) => void): EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write(d: string): void; end(): void };
      kill(sig?: string): boolean;
      killed: boolean;
    };
    on(event: string, cb: (...args: unknown[]) => void): EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write(d: string): void; end(): void };
      kill(sig?: string): boolean;
      killed: boolean;
    };
  };
  kills: string[];
  writes: string[];
  /** Simulate the worker sending a successful response */
  respond(id: string, data?: unknown): void;
  /** Simulate the worker sending a failure response */
  respondErr(id: string, error: string): void;
  /** Simulate unexpected close (crash) */
  crash(): void;
  /** Simulate graceful close (exits normally) */
  close(code?: number): void;
}

function makeFakeChild(opts?: { ignoreSigterm?: boolean }): FakeChild {
  const kills: string[] = [];
  const writes: string[] = [];
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  const ee = new EventEmitter() as FakeChild['proc'];
  (ee as unknown as Record<string, unknown>).stdout = stdout;
  (ee as unknown as Record<string, unknown>).stderr = stderr;
  (ee as unknown as Record<string, unknown>).killed = false;
  (ee as unknown as Record<string, unknown>).stdin = {
    write(d: string) {
      writes.push(d);
    },
    end() {},
  };

  (ee as unknown as Record<string, unknown>).kill = (sig = 'SIGTERM') => {
    kills.push(sig as string);
    (ee as unknown as Record<string, boolean>).killed = true;
    if (sig === 'SIGKILL' || !opts?.ignoreSigterm) {
      // emit close synchronously so listeners registered before kill() fire
      ee.emit('close', null, sig);
    }
    return true;
  };

  const child: FakeChild = {
    proc: ee,
    kills,
    writes,
    respond(id, data = {}) {
      stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ id, ok: true, data }) + '\n'),
      );
    },
    respondErr(id, error) {
      stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ id, ok: false, error }) + '\n'),
      );
    },
    crash() {
      ee.emit('close', 7, null);
    },
    close(code = 0) {
      ee.emit('close', code, null);
    },
  };
  return child;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake-timer helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FakeTimers {
  setTimer(cb: () => void, ms: number): number;
  clearTimer(h: unknown): void;
  clock(): number;
  advance(ms: number): void;
  reset(): void;
}

function makeFakeTimers(): FakeTimers {
  let now = 0;
  let seq = 0;
  const timers: Array<{ h: number; at: number; cb: () => void }> = [];

  return {
    clock: () => now,
    setTimer(cb, ms) {
      const h = ++seq;
      timers.push({ h, at: now + ms, cb });
      return h;
    },
    clearTimer(h) {
      const i = timers.findIndex((t) => t.h === (h as number));
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms) {
      now += ms;
      // fire timers in deadline order
      let fired = true;
      while (fired) {
        fired = false;
        for (let i = 0; i < timers.length; i++) {
          if (timers[i].at <= now) {
            const [t] = timers.splice(i, 1);
            t.cb();
            fired = true;
            break; // restart scan after mutation
          }
        }
      }
    },
    reset() {
      now = 0;
      seq = 0;
      timers.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a spawnFn that returns a new FakeChild on each call, collecting them. */
function makeFakeSpawnFn(
  children: FakeChild[],
  opts?: { ignoreSigterm?: boolean },
) {
  return () => {
    const child = makeFakeChild(opts);
    children.push(child);
    return child.proc as unknown as ChildProcess;
  };
}

/** Parse the last JSON message written to a fake child's stdin. */
function lastWrite(child: FakeChild): { id: string; payload: unknown } {
  const raw = child.writes[child.writes.length - 1];
  return JSON.parse(raw) as { id: string; payload: unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — A: real-spawn (echo worker)
// ─────────────────────────────────────────────────────────────────────────────

describe('real-spawn echo worker', () => {
  it('single worker handles a task and returns ok result', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 1,
    });
    const result = await pool.submit({ payload: { hello: 'world' } });
    expect(result.ok).toBe(true);
    expect((result as PoolResult).data).toEqual({ hello: 'world' });
    await pool.shutdown();
  });

  it('task with explicit id preserves it in result', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    const result = await pool.submit({ id: 'my-task-id', payload: 42 });
    expect(result.id).toBe('my-task-id');
    await pool.shutdown();
  });

  it('auto-generates id when omitted', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    const result = await pool.submit({ payload: 'ping' });
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    await pool.shutdown();
  });

  it('multiple sequential tasks share one worker', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 1,
    });
    const r1 = await pool.submit({ payload: 1 });
    const r2 = await pool.submit({ payload: 2 });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect((r1 as PoolResult).workerId).toBe((r2 as PoolResult).workerId);
    await pool.shutdown();
  });

  it('worker crash returns WORKER_CRASH failure', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 2,
    });
    const result = await pool.submit({ payload: { crash: true } });
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('WORKER_CRASH');
    await pool.shutdown();
  });

  it('durationMs is non-negative', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    const result = await pool.submit({ payload: 'x' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    await pool.shutdown();
  });

  it('result includes workerId', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    const result = await pool.submit({ payload: {} });
    expect(typeof result.workerId).toBe('string');
    expect(result.workerId.length).toBeGreaterThan(0);
    await pool.shutdown();
  });

  it('env is passed to spawn', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const pool = createSubprocessPool({
      command: process.execPath,
      args: [scriptPath],
      env: { ...process.env, MY_VAR: 'hello' } as Record<string, string>,
      spawnFn: (cmd, a, o) => {
        capturedEnv = o.env as Record<string, string>;
        return realSpawn(cmd, a, o);
      },
    });
    await pool.submit({ payload: 'ok' });
    expect(capturedEnv?.MY_VAR).toBe('hello');
    await pool.shutdown();
  });

  it('cwd is passed to spawn', async () => {
    let capturedCwd: string | undefined;
    const tmpCwd = os.tmpdir();
    const pool = createSubprocessPool({
      command: process.execPath,
      args: [scriptPath],
      cwd: tmpCwd,
      spawnFn: (cmd, a, o) => {
        capturedCwd = o.cwd as string;
        return realSpawn(cmd, a, o);
      },
    });
    await pool.submit({ payload: 'ok' });
    expect(capturedCwd).toBe(tmpCwd);
    await pool.shutdown();
  });

  it('task timeout returns WORKER_TIMEOUT failure', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 2,
    });
    const result = await pool.submit({
      payload: { sleepMs: 500 },
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('WORKER_TIMEOUT');
    await pool.shutdown();
  });

  it('defaultTimeoutMs applies when task has no explicit timeout', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      defaultTimeoutMs: 50,
      maxWorkers: 2,
    });
    const result = await pool.submit({ payload: { sleepMs: 500 } });
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('WORKER_TIMEOUT');
    await pool.shutdown();
  });

  it('maxTasksPerWorker recycles the worker', async () => {
    const workerIds = new Set<string>();
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 1,
      maxTasksPerWorker: 2,
    });
    for (let i = 0; i < 4; i++) {
      const r = await pool.submit({ payload: i });
      workerIds.add(r.workerId);
    }
    // After recycling at 2 tasks, there should be multiple worker IDs
    expect(workerIds.size).toBeGreaterThan(1);
    await pool.shutdown();
  });

  it('pool recovers after crash and processes next task', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      args: [scriptPath],
      maxWorkers: 2,
    });
    const fail = await pool.submit({ payload: { crash: true } });
    expect(fail.ok).toBe(false);
    // Next task should still succeed (replacement worker spawned)
    const ok = await pool.submit({ payload: 'after-crash' });
    expect(ok.ok).toBe(true);
    await pool.shutdown();
  });

  it('shutdown gracefully drains in-flight task', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    const p = pool.submit({ payload: { sleepMs: 100 } });
    const shutdownP = pool.shutdown();
    const [result] = await Promise.all([p, shutdownP]);
    expect(result.ok).toBe(true);
  });

  it('submit after shutdown returns POOL_SHUTDOWN failure', async () => {
    const pool = createSubprocessPool({ command: 'node', args: [scriptPath] });
    await pool.shutdown();
    const result = await pool.submit({ payload: 'late' });
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('POOL_SHUTDOWN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — B: fake-spawn (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

describe('fake-spawn: multi-worker and queue', () => {
  it('spawns up to maxWorkers workers for concurrent tasks', () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 3,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    pool.submit({ payload: 'a' });
    pool.submit({ payload: 'b' });
    pool.submit({ payload: 'c' });

    expect(children.length).toBe(3);
    expect(pool.getStats().activeWorkers).toBe(3);
  });

  it('queues tasks when all workers are busy', () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    pool.submit({ payload: 1 });
    pool.submit({ payload: 2 });
    pool.submit({ payload: 3 }); // should queue

    expect(children.length).toBe(2);
    expect(pool.getStats().queueDepth).toBe(1);
  });

  it('dequeues task when worker becomes idle', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p1 = pool.submit({ id: 'task-1', payload: 1 });
    const p2 = pool.submit({ id: 'task-2', payload: 2 }); // queued

    expect(pool.getStats().queueDepth).toBe(1);

    // Complete first task
    const m1 = lastWrite(children[0]);
    children[0].respond(m1.id as string, 'done');

    const r1 = await p1;
    expect(r1.ok).toBe(true);

    // task-2 should now be assigned
    expect(pool.getStats().queueDepth).toBe(0);
    expect(pool.getStats().activeWorkers).toBe(1);

    const m2 = lastWrite(children[0]);
    children[0].respond(m2.id as string, 'done2');

    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect((r2 as PoolResult).data).toBe('done2');
  });

  it('worker crash returns WORKER_CRASH via fake spawn', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p = pool.submit({ id: 'crash-task', payload: {} });
    // crash the worker while it has an in-flight task
    children[0].crash();

    const result = await p;
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('WORKER_CRASH');
    expect(result.id).toBe('crash-task');
  });

  it('after crash a replacement worker is spawned for queued tasks', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p1 = pool.submit({ payload: 'first' });
    const p2 = pool.submit({ payload: 'second' }); // queued (maxWorkers=1)

    // Crash worker 1 while it's processing p1
    children[0].crash();
    await p1; // WORKER_CRASH

    // p2 should be assigned to a new worker (children[1])
    expect(children.length).toBe(2);
    const m = lastWrite(children[1]);
    children[1].respond(m.id as string, 'ok');
    const r2 = await p2;
    expect(r2.ok).toBe(true);
  });
});

describe('fake-spawn: task timeout (fake timers)', () => {
  it('task timeout returns WORKER_TIMEOUT and kills worker', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    const p = pool.submit({ payload: 'slow', timeoutMs: 100 });
    ft.advance(101);

    const result = await p;
    expect(result.ok).toBe(false);
    expect((result as PoolFailure).error).toBe('WORKER_TIMEOUT');
    expect(children[0].kills).toContain('SIGTERM');
  });

  it('timeout respawns a replacement worker', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    pool.submit({ payload: 'slow', timeoutMs: 50 });
    ft.advance(51);

    // Replacement worker should be spawned
    expect(children.length).toBe(2);
  });

  it('durationMs reflects fake clock elapsed time', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    const p = pool.submit({ payload: 'x', timeoutMs: 100 });
    ft.advance(101); // fires timeout at 100ms mark

    const result = await p;
    expect(result.durationMs).toBeGreaterThanOrEqual(100);
  });
});

describe('fake-spawn: maxTasksPerWorker', () => {
  it('recycles worker after N tasks (fake spawn)', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      maxTasksPerWorker: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    // First task
    const p1 = pool.submit({ id: 't1', payload: 1 });
    children[0].respond('t1', 'a');
    await p1;

    // Second task — completes the limit, triggers recycle
    const p2 = pool.submit({ id: 't2', payload: 2 });
    children[0].respond('t2', 'b');
    await p2;

    // A new (recycled) worker should have been spawned
    expect(children.length).toBe(2);
  });

  it('task after recycle goes to new worker', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      maxTasksPerWorker: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p1 = pool.submit({ id: 't1', payload: 1 });
    children[0].respond('t1');
    await p1;

    // Second task
    const p2 = pool.submit({ id: 't2', payload: 2 });
    expect(children.length).toBe(2);
    children[1].respond('t2');
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(r2.workerId).not.toBe((await p1).workerId);
  });
});

describe('fake-spawn: idleTimeoutMs', () => {
  it('idle worker above minWorkers is shut down after idle timeout', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 0,
      maxWorkers: 2,
      idleTimeoutMs: 100,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    // Submit and complete a task so a worker exists
    const p = pool.submit({ id: 'idle-task', payload: {} });
    children[0].respond('idle-task');
    await p;

    expect(pool.getStats().idleWorkers).toBe(1);

    // Advance past idleTimeoutMs
    ft.advance(101);

    expect(pool.getStats().idleWorkers).toBe(0);
    expect(children[0].kills).toContain('SIGTERM');
  });

  it('idle worker at minWorkers is NOT killed', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 1,
      maxWorkers: 2,
      idleTimeoutMs: 100,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    // minWorkers=1 so one worker spawned at startup
    expect(children.length).toBe(1);

    ft.advance(200);

    // Worker should still be alive (at min)
    expect(pool.getStats().idleWorkers).toBe(1);
    expect(children[0].kills.length).toBe(0);
    await pool.shutdown();
  });

  it('idle timer is cancelled when task is assigned', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 100,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
      clock: ft.clock,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    // Complete one task
    const p1 = pool.submit({ id: 'first', payload: {} });
    children[0].respond('first');
    await p1;
    // idle timer started at t=0 for 100ms

    // Advance 50ms — no kill yet
    ft.advance(50);
    expect(children[0].kills.length).toBe(0);

    // Submit new task — clears idle timer
    const p2 = pool.submit({ id: 'second', payload: {} });

    // Advance past original deadline (100ms total)
    ft.advance(60); // now at t=110ms
    // Worker should not have been killed (timer cleared)
    expect(children[0].kills.length).toBe(0);

    children[0].respond('second');
    await p2;
    await pool.shutdown();
  });
});

describe('fake-spawn: shutdown', () => {
  it('shutdown resolves immediately when pool is empty', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 0,
      spawnFn: makeFakeSpawnFn([]) as unknown as typeof realSpawn,
    });
    await expect(pool.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown gracefully SIGTERMs all idle workers', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 2,
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    expect(children.length).toBe(2);

    await pool.shutdown();

    expect(children[0].kills).toContain('SIGTERM');
    expect(children[1].kills).toContain('SIGTERM');
  });

  it('shutdown waits for in-flight task to complete before terminating', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p = pool.submit({ id: 'inflight', payload: {} });
    const shutdownP = pool.shutdown();

    // Shutdown should not have SIGTERMed yet (task still in flight)
    expect(children[0].kills.length).toBe(0);

    // Complete the task
    children[0].respond('inflight');
    await p;

    // Now shutdown should proceed
    await shutdownP;
    expect(children[0].kills).toContain('SIGTERM');
  });

  it('shutdown drains queued tasks before terminating', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p1 = pool.submit({ id: 'q1', payload: 1 });
    const p2 = pool.submit({ id: 'q2', payload: 2 }); // queued
    const shutdownP = pool.shutdown();

    // Complete first task → q2 dequeued
    children[0].respond('q1');
    await p1;

    // Complete second task
    children[0].respond('q2');
    await p2;

    await shutdownP;
    expect(children[0].kills).toContain('SIGTERM');
  });

  it('sends SIGKILL after graceMs if worker does not exit', async () => {
    const ft = makeFakeTimers();
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 1,
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children, {
        ignoreSigterm: true,
      }) as unknown as typeof realSpawn,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });

    // minWorkers=1 spawns one worker
    expect(children.length).toBe(1);

    const shutdownP = pool.shutdown({ graceMs: 100 });

    // SIGTERM sent, but worker ignores it
    expect(children[0].kills).toContain('SIGTERM');
    expect(children[0].kills).not.toContain('SIGKILL');

    // Advance past grace period
    ft.advance(101);

    // SIGKILL should now be in kills list
    expect(children[0].kills).toContain('SIGKILL');

    await shutdownP;
  });

  it('submit after shutdown returns POOL_SHUTDOWN', async () => {
    const pool = createSubprocessPool({
      command: 'node',
      minWorkers: 0,
      spawnFn: makeFakeSpawnFn([]) as unknown as typeof realSpawn,
    });
    await pool.shutdown();
    const r = await pool.submit({ id: 'late', payload: {} });
    expect(r.ok).toBe(false);
    expect((r as PoolFailure).error).toBe('POOL_SHUTDOWN');
    expect(r.id).toBe('late');
  });
});

describe('fake-spawn: getStats', () => {
  it('tracks totalSubmitted accurately', () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 3,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    pool.submit({ payload: 1 });
    pool.submit({ payload: 2 });
    pool.submit({ payload: 3 });
    expect(pool.getStats().totalSubmitted).toBe(3);
  });

  it('tracks totalCompleted after responses', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    const p1 = pool.submit({ id: 'c1', payload: 1 });
    const p2 = pool.submit({ id: 'c2', payload: 2 });

    children[0].respond('c1');
    children[1].respond('c2');
    await Promise.all([p1, p2]);

    const stats = pool.getStats();
    expect(stats.totalCompleted).toBe(2);
    expect(stats.totalFailed).toBe(0);
  });

  it('tracks totalFailed on crash', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    const p = pool.submit({ id: 'fail-1', payload: {} });
    children[0].crash();
    await p;
    expect(pool.getStats().totalFailed).toBe(1);
    expect(pool.getStats().totalCompleted).toBe(0);
  });

  it('reports queueDepth correctly', () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    pool.submit({ payload: 1 });
    pool.submit({ payload: 2 });
    pool.submit({ payload: 3 });
    expect(pool.getStats().queueDepth).toBe(2);
  });

  it('reports activeWorkers and idleWorkers correctly', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 2,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    pool.submit({ id: 'active-1', payload: 1 });
    pool.submit({ id: 'active-2', payload: 2 });

    let stats = pool.getStats();
    expect(stats.activeWorkers).toBe(2);
    expect(stats.idleWorkers).toBe(0);

    children[0].respond('active-1');
    await new Promise((r) => setImmediate(r));

    stats = pool.getStats();
    expect(stats.idleWorkers).toBe(1);
    expect(stats.activeWorkers).toBe(1);
  });

  it('perWorker stats track tasksRun per worker', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p1 = pool.submit({ id: 'pw1', payload: 1 });
    children[0].respond('pw1');
    await p1;

    const p2 = pool.submit({ id: 'pw2', payload: 2 });
    children[0].respond('pw2');
    await p2;

    const stats = pool.getStats();
    const wid = Object.keys(stats.perWorker)[0];
    expect(stats.perWorker[wid].tasksRun).toBe(2);
    expect(stats.perWorker[wid].failures).toBe(0);
  });

  it('perWorker failures incremented on worker error response', async () => {
    const children: FakeChild[] = [];
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });

    const p = pool.submit({ id: 'err-task', payload: {} });
    children[0].respondErr('err-task', 'some_error');
    await p;

    const stats = pool.getStats();
    const wid = Object.keys(stats.perWorker)[0];
    expect(stats.perWorker[wid].failures).toBe(1);
  });

  it('minWorkers causes workers to be spawned at startup', () => {
    const children: FakeChild[] = [];
    createSubprocessPool({
      command: 'node',
      minWorkers: 3,
      maxWorkers: 5,
      spawnFn: makeFakeSpawnFn(children) as unknown as typeof realSpawn,
    });
    expect(children.length).toBe(3);
  });

  it('spawnFn injection is used instead of real spawn', () => {
    let called = false;
    const pool = createSubprocessPool({
      command: 'node',
      maxWorkers: 1,
      spawnFn: (() => {
        called = true;
        return makeFakeChild().proc as unknown as ChildProcess;
      }) as unknown as typeof realSpawn,
    });
    pool.submit({ payload: {} });
    expect(called).toBe(true);
  });
});
