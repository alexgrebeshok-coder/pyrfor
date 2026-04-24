// @vitest-environment node
/**
 * shell-runner.test.ts
 *
 * All tests use an injected fake spawn — no real child processes are created.
 * Timing is deterministic via injected clock and fake setTimer/clearTimer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable, Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  createShellRunner,
  ShellRunnerError,
  type RunPolicy,
} from './shell-runner.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake child-process infrastructure
// ─────────────────────────────────────────────────────────────────────────────

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  kill: (sig?: string) => boolean;
  killed: boolean;
  _kills: string[];
  _stdinChunks: string[];
  /** Emit data on stdout */
  emitStdout(data: string): void;
  /** Emit data on stderr */
  emitStderr(data: string): void;
  /** Simulate process exit */
  exit(code: number | null, signal?: NodeJS.Signals | null): void;
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  const kills: string[] = [];
  const stdinChunks: string[] = [];

  // Stdout readable
  const stdoutEmitter = new EventEmitter();
  const stdoutStream = Object.assign(stdoutEmitter, { destroy() {} }) as unknown as Readable;

  // Stderr readable
  const stderrEmitter = new EventEmitter();
  const stderrStream = Object.assign(stderrEmitter, { destroy() {} }) as unknown as Readable;

  // Stdin writable (captures written data)
  const stdinStream = new Writable({
    write(chunk, _enc, cb) {
      stdinChunks.push(chunk.toString());
      cb();
    },
  });

  ee.stdout = stdoutStream;
  ee.stderr = stderrStream;
  ee.stdin = stdinStream;
  ee._kills = kills;
  ee._stdinChunks = stdinChunks;
  ee.killed = false;

  ee.kill = (sig = 'SIGTERM') => {
    kills.push(sig);
    ee.killed = true;
    return true;
  };

  ee.emitStdout = (data: string) => stdoutEmitter.emit('data', Buffer.from(data));
  ee.emitStderr = (data: string) => stderrEmitter.emit('data', Buffer.from(data));
  ee.exit = (code: number | null, signal: NodeJS.Signals | null = null) => {
    ee.emit('close', code, signal);
  };

  return ee;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake clock + timer infrastructure
// ─────────────────────────────────────────────────────────────────────────────

interface FakeClock {
  now: number;
  tick(ms: number): void;
  fn(): number;
}

function makeClock(startMs = 1_000_000): FakeClock {
  let now = startMs;
  return {
    get now() { return now; },
    tick(ms: number) { now += ms; },
    fn() { return now; },
  };
}

interface PendingTimer {
  id: number;
  cb: () => void;
  fireAt: number;
}

interface FakeTimers {
  setTimer(cb: () => void, ms: number): number;
  clearTimer(h: unknown): void;
  /** Fire all timers whose fireAt <= clock.now */
  flush(clock: FakeClock): void;
  /** Advance clock by ms and flush */
  advance(clock: FakeClock, ms: number): void;
  pending: PendingTimer[];
}

function makeFakeTimers(): FakeTimers {
  let seq = 0;
  const pending: PendingTimer[] = [];

  return {
    pending,
    setTimer(cb, ms) {
      const id = ++seq;
      pending.push({ id, cb, fireAt: ms }); // store relative ms; flush resolves
      return id;
    },
    clearTimer(h) {
      const idx = pending.findIndex((t) => t.id === h);
      if (idx !== -1) pending.splice(idx, 1);
    },
    flush(clock) {
      // Fire all timers whose relative delay has been exceeded by advancing
      // We store absolute fireAt after advance
      const now = clock.fn();
      const toFire = pending.filter((t) => t.fireAt <= now);
      toFire.forEach((t) => {
        const idx = pending.indexOf(t);
        if (idx !== -1) pending.splice(idx, 1);
        t.cb();
      });
    },
    advance(clock, ms) {
      // Convert relative delays to absolute on first advance
      // Simpler: store fireAt as absolute from creation time
      clock.tick(ms);
      this.flush(clock);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRunner(policy?: RunPolicy) {
  const clock = makeClock();
  const timers = makeFakeTimers();
  let lastChild: FakeChild | null = null;

  const spawnFn = (_cmd: string, _args: string[], _opts: unknown) => {
    lastChild = makeFakeChild();
    return lastChild as unknown as ReturnType<typeof import('node:child_process').spawn>;
  };

  // Convert timer delays to absolute on creation
  const absoluteTimers: FakeTimers = {
    ...timers,
    setTimer(cb, ms) {
      const id = (timers as unknown as { setTimer: FakeTimers['setTimer'] }).setTimer.call(timers, cb, ms);
      // Overwrite fireAt with absolute time
      const t = timers.pending.find((p) => p.id === id);
      if (t) t.fireAt = clock.fn() + ms;
      return id;
    },
  };

  const runner = createShellRunner({
    policy,
    clock: clock.fn,
    spawnFn,
    setTimer: absoluteTimers.setTimer.bind(absoluteTimers),
    clearTimer: timers.clearTimer.bind(timers),
  });

  return {
    runner,
    clock,
    timers,
    absoluteTimers,
    getChild: () => lastChild!,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('shell-runner', () => {

  // ── stdout capture ─────────────────────────────────────────────────────────

  it('captures stdout from child process', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('echo', ['hello']);
    getChild().emitStdout('hello world\n');
    getChild().exit(0);
    const result = await p;
    expect(result.stdout).toBe('hello world\n');
    expect(result.truncatedStdout).toBe(false);
  });

  // ── stderr capture ─────────────────────────────────────────────────────────

  it('captures stderr from child process', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cmd', []);
    getChild().emitStderr('error output\n');
    getChild().exit(1);
    const result = await p;
    expect(result.stderr).toBe('error output\n');
    expect(result.truncatedStderr).toBe(false);
  });

  // ── RunResult shape ────────────────────────────────────────────────────────

  it('returns a complete RunResult with all fields', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('ls', ['-la']);
    getChild().emitStdout('file1\nfile2\n');
    getChild().emitStderr('warn\n');
    getChild().exit(0);
    const result = await p;
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: 'file1\nfile2\n',
      stderr: 'warn\n',
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: false,
    });
    expect(typeof result.durationMs).toBe('number');
  });

  // ── exitCode propagated ────────────────────────────────────────────────────

  it('propagates non-zero exit code', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('false', []);
    getChild().exit(127);
    const result = await p;
    expect(result.exitCode).toBe(127);
    expect(result.signal).toBeNull();
  });

  it('propagates zero exit code', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('true', []);
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  // ── signal propagated ─────────────────────────────────────────────────────

  it('propagates exit signal when child is killed by signal', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('sleep', ['10']);
    getChild().exit(null, 'SIGKILL');
    const result = await p;
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGKILL');
  });

  it('propagates SIGTERM exit signal', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('sleep', ['10']);
    getChild().exit(null, 'SIGTERM');
    const result = await p;
    expect(result.signal).toBe('SIGTERM');
  });

  // ── timeout / SIGTERM ──────────────────────────────────────────────────────

  it('sends SIGTERM on timeout and sets timedOut=true', async () => {
    const { runner, getChild, clock, timers } = makeRunner();
    const p = runner.run('sleep', ['999'], { timeoutMs: 1000 });

    // Advance clock past timeout
    clock.tick(1001);
    timers.flush(clock);

    // Now the SIGTERM should have been sent; simulate process exiting
    getChild().exit(null, 'SIGTERM');
    const result = await p;
    expect(result.timedOut).toBe(true);
    expect(getChild()._kills).toContain('SIGTERM');
  });

  it('does not set timedOut if process exits before timeout', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('echo', ['fast'], { timeoutMs: 5000 });
    getChild().emitStdout('fast\n');
    getChild().exit(0);
    const result = await p;
    expect(result.timedOut).toBe(false);
  });

  // ── timeout / SIGKILL grace ────────────────────────────────────────────────

  it('sends SIGKILL 5000ms after SIGTERM if process does not exit', async () => {
    const { runner, getChild, clock, timers } = makeRunner();
    const p = runner.run('sleep', ['999'], { timeoutMs: 1000 });

    // Fire the SIGTERM timer
    clock.tick(1001);
    timers.flush(clock);
    expect(getChild()._kills).toContain('SIGTERM');

    // SIGKILL timer registered for 5000ms later — advance past it
    clock.tick(5001);
    timers.flush(clock);
    expect(getChild()._kills).toContain('SIGKILL');

    getChild().exit(null, 'SIGKILL');
    const result = await p;
    expect(result.timedOut).toBe(true);
  });

  it('does NOT send SIGKILL if process exits after SIGTERM before grace period', async () => {
    const { runner, getChild, clock, timers } = makeRunner();
    const p = runner.run('sleep', ['999'], { timeoutMs: 1000 });

    clock.tick(1001);
    timers.flush(clock);
    // Process dies after SIGTERM
    getChild().exit(null, 'SIGTERM');
    await p;

    // Advance past SIGKILL window — should not fire (timer was cleared)
    clock.tick(5001);
    timers.flush(clock);
    expect(getChild()._kills.filter((s) => s === 'SIGKILL')).toHaveLength(0);
  });

  // ── maxStdoutBytes ─────────────────────────────────────────────────────────

  it('truncates stdout at maxStdoutBytes and sets truncatedStdout=true', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('bigcmd', [], { maxStdoutBytes: 5 });
    getChild().emitStdout('hello world'); // 11 bytes > 5
    getChild().exit(0);
    const result = await p;
    expect(result.truncatedStdout).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(5);
  });

  it('does not truncate stdout when output is within limit', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cmd', [], { maxStdoutBytes: 100 });
    getChild().emitStdout('short');
    getChild().exit(0);
    const result = await p;
    expect(result.truncatedStdout).toBe(false);
    expect(result.stdout).toBe('short');
  });

  // ── maxStderrBytes ─────────────────────────────────────────────────────────

  it('truncates stderr at maxStderrBytes and sets truncatedStderr=true', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cmd', [], { maxStderrBytes: 3 });
    getChild().emitStderr('error message too long');
    getChild().exit(1);
    const result = await p;
    expect(result.truncatedStderr).toBe(true);
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(3);
  });

  it('subsequent stderr chunks after limit are ignored', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cmd', [], { maxStderrBytes: 4 });
    getChild().emitStderr('abcd'); // exactly 4 bytes
    getChild().emitStderr('more'); // should be dropped
    getChild().exit(0);
    const result = await p;
    expect(result.stderr).toBe('abcd');
    expect(result.truncatedStderr).toBe(true);
  });

  // ── stdin ──────────────────────────────────────────────────────────────────

  it('writes stdin to child process stdin stream', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cat', [], { stdin: 'hello stdin' });
    getChild().emitStdout('hello stdin');
    getChild().exit(0);
    await p;
    expect(getChild()._stdinChunks.join('')).toBe('hello stdin');
  });

  it('does not write stdin if opts.stdin is not provided', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cat', []);
    getChild().exit(0);
    await p;
    expect(getChild()._stdinChunks).toHaveLength(0);
  });

  // ── AbortSignal ────────────────────────────────────────────────────────────

  it('sends SIGTERM when external AbortSignal is aborted', async () => {
    const { runner, getChild } = makeRunner();
    const controller = new AbortController();
    const p = runner.run('sleep', ['60'], { signal: controller.signal });

    controller.abort();
    getChild().exit(null, 'SIGTERM');
    await p;

    expect(getChild()._kills).toContain('SIGTERM');
  });

  it('sends SIGTERM immediately if AbortSignal is already aborted', async () => {
    const { runner, getChild } = makeRunner();
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const p = runner.run('sleep', ['60'], { signal: controller.signal });
    getChild().exit(null, 'SIGTERM');
    await p;

    expect(getChild()._kills).toContain('SIGTERM');
  });

  // ── policy: blockedCommands ────────────────────────────────────────────────

  it('throws ShellRunnerError(command_blocked) for blocked command', () => {
    const { runner } = makeRunner({ blockedCommands: ['rm'] });
    let caught: unknown;
    try { runner.run('rm', ['-rf', '/']); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ShellRunnerError);
    expect((caught as ShellRunnerError).code).toBe('command_blocked');
  });

  it('allows commands not in blockedCommands', async () => {
    const { runner, getChild } = makeRunner({ blockedCommands: ['rm'] });
    const p = runner.run('ls', []);
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  it('blocked command error has correct code property', () => {
    const { runner } = makeRunner({ blockedCommands: ['curl'] });
    let caught: ShellRunnerError | null = null;
    try {
      runner.run('curl', ['https://example.com']);
    } catch (e) {
      caught = e as ShellRunnerError;
    }
    expect(caught?.code).toBe('command_blocked');
  });

  // ── policy: allowedCommands ────────────────────────────────────────────────

  it('throws command_not_allowed for command outside allowedCommands', () => {
    const { runner } = makeRunner({ allowedCommands: ['git', 'ffmpeg'] });
    let caught: unknown;
    try { runner.run('curl', []); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ShellRunnerError);
    expect((caught as ShellRunnerError).code).toBe('command_not_allowed');
  });

  it('allows command in allowedCommands list', async () => {
    const { runner, getChild } = makeRunner({ allowedCommands: ['git', 'ffmpeg'] });
    const p = runner.run('git', ['status']);
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  it('allows any command when allowedCommands is empty/undefined', async () => {
    const { runner, getChild } = makeRunner({});
    const p = runner.run('any-command', []);
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  // ── policy: allowedCwdPrefixes ─────────────────────────────────────────────

  it('throws cwd_not_allowed when cwd is outside all allowed prefixes', () => {
    const { runner } = makeRunner({ allowedCwdPrefixes: ['/safe/dir'] });
    let caught: unknown;
    try { runner.run('ls', [], { cwd: '/unsafe/dir' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ShellRunnerError);
    expect((caught as ShellRunnerError).code).toBe('cwd_not_allowed');
  });

  it('allows cwd under an allowed prefix', async () => {
    const { runner, getChild } = makeRunner({ allowedCwdPrefixes: ['/safe/dir'] });
    const p = runner.run('ls', [], { cwd: '/safe/dir/subdir' });
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  it('allows cwd exactly matching an allowed prefix', async () => {
    const { runner, getChild } = makeRunner({ allowedCwdPrefixes: ['/safe/dir'] });
    const p = runner.run('ls', [], { cwd: '/safe/dir' });
    getChild().exit(0);
    const result = await p;
    expect(result.exitCode).toBe(0);
  });

  // ── envInherit: false ──────────────────────────────────────────────────────

  it('starts with empty env when envInherit is false (default)', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    const p = runner.run('env', []);
    await p;
    // env should be empty (no inherited keys)
    expect(capturedEnv).toEqual({});
  });

  it('does not inherit PATH or HOME when envInherit is false', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    await runner.run('env', [], { envInherit: false });
    expect(capturedEnv?.PATH).toBeUndefined();
    expect(capturedEnv?.HOME).toBeUndefined();
  });

  // ── envInherit: true ───────────────────────────────────────────────────────

  it('includes process.env keys when envInherit is true', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    process.env.__TEST_SHELL_RUNNER__ = 'yes';
    try {
      await runner.run('env', [], { envInherit: true });
      expect(capturedEnv?.['__TEST_SHELL_RUNNER__']).toBe('yes');
    } finally {
      delete process.env.__TEST_SHELL_RUNNER__;
    }
  });

  it('opts.env overlays inherited env', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    process.env.OVERRIDE_ME = 'original';
    try {
      await runner.run('cmd', [], { envInherit: true, env: { OVERRIDE_ME: 'overridden', NEW_KEY: 'new' } });
      expect(capturedEnv?.OVERRIDE_ME).toBe('overridden');
      expect(capturedEnv?.NEW_KEY).toBe('new');
    } finally {
      delete process.env.OVERRIDE_ME;
    }
  });

  // ── envWhitelist ───────────────────────────────────────────────────────────

  it('drops keys not in envWhitelist', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({
      spawnFn: spySpawn as typeof import('node:child_process').spawn,
      policy: { envWhitelist: ['ALLOWED_KEY'] },
    });
    await runner.run('cmd', [], { env: { ALLOWED_KEY: 'yes', SECRET: 'no' } });
    expect(capturedEnv?.ALLOWED_KEY).toBe('yes');
    expect(capturedEnv?.SECRET).toBeUndefined();
  });

  it('keeps only whitelisted keys from inherited env', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const spySpawn = (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
      capturedEnv = opts.env;
      const child = makeFakeChild();
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({
      spawnFn: spySpawn as typeof import('node:child_process').spawn,
      policy: { envWhitelist: ['PATH'] },
    });
    await runner.run('cmd', [], { envInherit: true });
    const keys = Object.keys(capturedEnv ?? {});
    expect(keys.every((k) => k === 'PATH')).toBe(true);
  });

  // ── which ──────────────────────────────────────────────────────────────────

  it('which returns trimmed path when command exits 0 with output', async () => {
    const spySpawn = (_cmd: string, _args: string[], _opts: unknown) => {
      const child = makeFakeChild();
      setTimeout(() => {
        child.emitStdout('/usr/bin/git\n');
        child.exit(0);
      }, 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    const result = await runner.which('git');
    expect(result).toBe('/usr/bin/git');
  });

  it('which returns null when command exits non-zero', async () => {
    const spySpawn = (_cmd: string, _args: string[], _opts: unknown) => {
      const child = makeFakeChild();
      setTimeout(() => {
        child.emitStdout('');
        child.exit(1);
      }, 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    const result = await runner.which('nonexistent');
    expect(result).toBeNull();
  });

  it('which returns null when spawn emits error', async () => {
    const spySpawn = (_cmd: string, _args: string[], _opts: unknown) => {
      const child = makeFakeChild();
      setTimeout(() => {
        child.emit('error', new Error('spawn ENOENT'));
      }, 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({ spawnFn: spySpawn as typeof import('node:child_process').spawn });
    const result = await runner.which('bogus');
    expect(result).toBeNull();
  });

  // ── setPolicy ─────────────────────────────────────────────────────────────

  it('setPolicy updates the runner policy at runtime', () => {
    const { runner, getChild } = makeRunner();

    // Initially no policy — any command allowed
    const p = runner.run('curl', []);

    runner.setPolicy({ blockedCommands: ['curl'] });

    // Now curl is blocked
    let caught: unknown;
    try { runner.run('curl', []); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ShellRunnerError);
    expect((caught as ShellRunnerError).code).toBe('command_blocked');

    getChild().exit(0); // clean up first run
  });

  // ── durationMs ────────────────────────────────────────────────────────────

  it('reports accurate durationMs via injected clock', async () => {
    const clock = makeClock(0);
    const spySpawn = (_cmd: string, _args: string[], _opts: unknown) => {
      const child = makeFakeChild();
      clock.tick(250); // simulate 250ms execution
      setTimeout(() => child.exit(0), 0);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
    const runner = createShellRunner({
      clock: clock.fn,
      spawnFn: spySpawn as typeof import('node:child_process').spawn,
    });
    const result = await runner.run('work', []);
    expect(result.durationMs).toBe(250);
  });

  // ── error event ───────────────────────────────────────────────────────────

  it('resolves with null exitCode when child emits error event', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('bad', []);
    getChild().emit('error', new Error('spawn ENOENT'));
    const result = await p;
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBeNull();
  });

  // ── multiple stdout chunks ─────────────────────────────────────────────────

  it('concatenates multiple stdout chunks', async () => {
    const { runner, getChild } = makeRunner();
    const p = runner.run('cmd', []);
    getChild().emitStdout('chunk1\n');
    getChild().emitStdout('chunk2\n');
    getChild().emitStdout('chunk3\n');
    getChild().exit(0);
    const result = await p;
    expect(result.stdout).toBe('chunk1\nchunk2\nchunk3\n');
  });

});
