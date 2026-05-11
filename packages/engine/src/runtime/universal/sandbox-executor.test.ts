import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandboxExecutor, type SandboxRunOptions } from './sandbox-executor';

describe('LocalProcess sandbox executor', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'pyrfor-sandbox-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('captures stdout', async () => {
    const executor = await createSandboxExecutor('local-process');

    const result = await executor.run(nodeScript("process.stdout.write('hello\\n')"));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.backend).toBe('local-process');
  });

  it('captures stderr', async () => {
    const executor = await createSandboxExecutor();

    const result = await executor.run(nodeScript("process.stderr.write('bad\\n')"));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('bad\n');
  });

  it('returns non-zero exit codes without timing out', async () => {
    const executor = await createSandboxExecutor();

    const result = await executor.run(nodeScript('process.exit(7)'));

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it('kills timed out processes', async () => {
    const executor = await createSandboxExecutor();
    const startedAt = Date.now();

    const result = await executor.run(nodeScript('setTimeout(() => {}, 10_000)', { timeoutMs: 100 }));

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('caps stdout output', async () => {
    const executor = await createSandboxExecutor();

    const result = await executor.run(nodeScript("process.stdout.write('x'.repeat(10_000))", {
      maxOutputBytes: 128,
    }));

    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(128);
  });

  it('runs inside the requested workdir', async () => {
    const executor = await createSandboxExecutor();

    const result = await executor.run(nodeScript('process.stdout.write(process.cwd())'));

    expect(result.stdout).toBe(realpathSync(workdir));
  });

  it('does not inherit HOME unless explicit env is provided', async () => {
    const executor = await createSandboxExecutor();

    const isolated = await executor.run(nodeScript("process.stdout.write(process.env.HOME ?? '')"));
    const explicit = await executor.run(nodeScript("process.stdout.write(process.env.HOME ?? '')", {
      env: { PATH: '/usr/bin:/bin', HOME: '/sandbox/home' },
    }));

    expect(isolated.stdout).toBe('');
    expect(explicit.stdout).toBe('/sandbox/home');
  });

  it('executes script files without shell interpolation', async () => {
    const executor = await createSandboxExecutor();
    const script = path.join(workdir, 'script.sh');
    writeFileSync(script, '#!/bin/sh\necho "$1"\n', 'utf8');
    chmodSync(script, 0o755);

    const result = await executor.run({
      implPath: script,
      args: ['hello; rm -rf /'],
      workdir,
    });

    expect(result.stdout).toBe('hello; rm -rf /\n');
  });

  function nodeScript(code: string, overrides: Partial<SandboxRunOptions> = {}): SandboxRunOptions {
    return {
      implPath: process.execPath,
      args: ['-e', code],
      workdir,
      ...overrides,
    };
  }
});
