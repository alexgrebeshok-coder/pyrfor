/**
 * shell-runner.ts — Safe subprocess wrapper around node:child_process.spawn.
 *
 * Features:
 * - Policy enforcement (allowed/blocked commands, cwd prefixes)
 * - Env scrubbing (inherit or empty base, overlay, whitelist)
 * - Timeout with SIGTERM + SIGKILL grace period
 * - Output capture with byte limits
 * - External AbortSignal support
 * - Stdin piping
 * - Fully injectable for deterministic tests (spawnFn, clock, setTimer/clearTimer)
 *
 * No external dependencies.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RunOpts = {
  cwd?: string;
  env?: Record<string, string>;
  /** If true, inherit process.env as base before overlaying opts.env. Default: false */
  envInherit?: boolean;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  stdin?: string;
  logger?: (msg: string, meta?: unknown) => void;
};

export type RunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  timedOut: boolean;
};

export type RunPolicy = {
  allowedCommands?: string[];
  blockedCommands?: string[];
  allowedCwdPrefixes?: string[];
  envWhitelist?: string[];
};

export class ShellRunnerError extends Error {
  constructor(
    public readonly code:
      | 'command_blocked'
      | 'command_not_allowed'
      | 'cwd_not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'ShellRunnerError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory options
// ─────────────────────────────────────────────────────────────────────────────

export type CreateShellRunnerOptions = {
  policy?: RunPolicy;
  clock?: () => number;
  spawnFn?: typeof nodeSpawn;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  logger?: (msg: string, meta?: unknown) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Platform helpers
// ─────────────────────────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32';

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function createShellRunner(opts: CreateShellRunnerOptions = {}) {
  let policy: RunPolicy = opts.policy ?? {};
  const clock = opts.clock ?? (() => Date.now());
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const defaultLogger = opts.logger;

  // ── Policy enforcement ──────────────────────────────────────────────────

  function enforcePolicy(command: string, cwd: string | undefined): void {
    const { blockedCommands, allowedCommands, allowedCwdPrefixes } = policy;

    if (blockedCommands && blockedCommands.includes(command)) {
      throw new ShellRunnerError('command_blocked', `Command "${command}" is blocked by policy`);
    }

    if (allowedCommands && allowedCommands.length > 0 && !allowedCommands.includes(command)) {
      throw new ShellRunnerError(
        'command_not_allowed',
        `Command "${command}" is not in the allowedCommands list`,
      );
    }

    if (allowedCwdPrefixes && allowedCwdPrefixes.length > 0) {
      const effectiveCwd = cwd ?? process.cwd();
      const normalised = effectiveCwd.endsWith('/') ? effectiveCwd : effectiveCwd + '/';
      const allowed = allowedCwdPrefixes.some((prefix) => {
        const normPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
        return normalised.startsWith(normPrefix) || effectiveCwd === prefix;
      });
      if (!allowed) {
        throw new ShellRunnerError(
          'cwd_not_allowed',
          `cwd "${effectiveCwd}" is not under any allowed prefix`,
        );
      }
    }
  }

  // ── Env construction ────────────────────────────────────────────────────

  function buildEnv(
    runOpts: RunOpts,
  ): Record<string, string> {
    let env: Record<string, string> = {};

    if (runOpts.envInherit) {
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
      }
    }

    if (runOpts.env) {
      Object.assign(env, runOpts.env);
    }

    const whitelist = policy.envWhitelist;
    if (whitelist && whitelist.length > 0) {
      const filtered: Record<string, string> = {};
      for (const key of whitelist) {
        if (key in env) filtered[key] = env[key];
      }
      env = filtered;
    }

    return env;
  }

  // ── Main run ────────────────────────────────────────────────────────────

  function run(command: string, args: string[], runOpts: RunOpts = {}): Promise<RunResult> {
    const log = runOpts.logger ?? defaultLogger;

    enforcePolicy(command, runOpts.cwd);

    const env = buildEnv(runOpts);
    const startMs = clock();

    return new Promise<RunResult>((resolve) => {
      const child = spawnFn(command, args, {
        cwd: runOpts.cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcess;

      log?.('shell-runner:spawn', { command, args, cwd: runOpts.cwd });

      let stdoutBuf = '';
      let stderrBuf = '';
      let truncatedStdout = false;
      let truncatedStderr = false;
      let timedOut = false;
      let settled = false;

      const maxOut = runOpts.maxStdoutBytes ?? Infinity;
      const maxErr = runOpts.maxStderrBytes ?? Infinity;

      // ── Output capture ──────────────────────────────────────────────

      child.stdout?.on('data', (chunk: Buffer) => {
        if (truncatedStdout) return;
        const str = chunk.toString();
        const remaining = maxOut - Buffer.byteLength(stdoutBuf, 'utf8');
        if (remaining <= 0) {
          truncatedStdout = true;
          return;
        }
        const bytes = Buffer.byteLength(str, 'utf8');
        if (bytes <= remaining) {
          stdoutBuf += str;
        } else {
          // Append only as many bytes as fit
          stdoutBuf += Buffer.from(str).slice(0, remaining).toString('utf8');
          truncatedStdout = true;
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (truncatedStderr) return;
        const str = chunk.toString();
        const remaining = maxErr - Buffer.byteLength(stderrBuf, 'utf8');
        if (remaining <= 0) {
          truncatedStderr = true;
          return;
        }
        const bytes = Buffer.byteLength(str, 'utf8');
        if (bytes <= remaining) {
          stderrBuf += str;
        } else {
          stderrBuf += Buffer.from(str).slice(0, remaining).toString('utf8');
          truncatedStderr = true;
        }
      });

      // ── Stdin ───────────────────────────────────────────────────────

      if (runOpts.stdin != null && child.stdin) {
        child.stdin.write(runOpts.stdin);
        child.stdin.end();
      }

      // ── Settlement helper ───────────────────────────────────────────

      function settle(exitCode: number | null, exitSignal: NodeJS.Signals | null): void {
        if (settled) return;
        settled = true;

        clearTimer(killTimer);
        clearTimer(sigkillTimer);
        abortCleanup();

        const durationMs = clock() - startMs;
        log?.('shell-runner:exit', { exitCode, exitSignal, durationMs, timedOut });

        resolve({
          exitCode,
          signal: exitSignal,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          durationMs,
          truncatedStdout,
          truncatedStderr,
          timedOut,
        });
      }

      // ── Timeout ─────────────────────────────────────────────────────

      let killTimer: unknown = undefined;
      let sigkillTimer: unknown = undefined;

      if (runOpts.timeoutMs != null) {
        killTimer = setTimer(() => {
          timedOut = true;
          log?.('shell-runner:timeout:sigterm', { command, timeoutMs: runOpts.timeoutMs });
          try { child.kill('SIGTERM'); } catch { /* already dead */ }

          sigkillTimer = setTimer(() => {
            log?.('shell-runner:timeout:sigkill', { command });
            try { child.kill('SIGKILL'); } catch { /* already dead */ }
          }, 5_000);
        }, runOpts.timeoutMs);
      }

      // ── External AbortSignal ────────────────────────────────────────

      let abortCleanup = () => {};

      if (runOpts.signal) {
        const abortSig = runOpts.signal;

        if (abortSig.aborted) {
          try { child.kill('SIGTERM'); } catch { /* already dead */ }
        } else {
          const onAbort = () => {
            log?.('shell-runner:aborted', { command });
            try { child.kill('SIGTERM'); } catch { /* already dead */ }
          };
          abortSig.addEventListener('abort', onAbort);
          abortCleanup = () => abortSig.removeEventListener('abort', onAbort);
        }
      }

      // ── Process close ───────────────────────────────────────────────

      child.on('close', (code: number | null, sig: NodeJS.Signals | null) => {
        settle(code, sig);
      });

      child.on('error', (err: Error) => {
        log?.('shell-runner:error', { command, err: err.message });
        settle(null, null);
      });
    });
  }

  // ── which ───────────────────────────────────────────────────────────────

  function which(command: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const [cmd, args] = isWindows
        ? ['where', [command]]
        : ['command', ['-v', command]];

      const child = spawnFn(cmd, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      }) as ChildProcess;

      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });

      child.on('close', (code: number | null) => {
        if (code === 0 && out.trim()) {
          resolve(out.trim().split('\n')[0].trim());
        } else {
          resolve(null);
        }
      });

      child.on('error', () => resolve(null));
    });
  }

  // ── setPolicy ───────────────────────────────────────────────────────────

  function setPolicy(p: RunPolicy): void {
    policy = p;
  }

  return { run, which, setPolicy };
}

export type ShellRunner = ReturnType<typeof createShellRunner>;
