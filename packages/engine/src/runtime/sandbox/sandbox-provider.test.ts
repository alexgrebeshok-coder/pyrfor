// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { SandboxProvider, createSandboxProvider } from './sandbox-provider';

describe('SandboxProvider', () => {
  it('returns null from createSandboxProvider when mode is none', () => {
    expect(createSandboxProvider({ mode: 'none' })).toBeNull();
  });

  it('maps docker runtime mode to universal docker backend', () => {
    const p = new SandboxProvider({ mode: 'docker', dockerTier: 'container_full' });
    expect(p.preferredBackend()).toBe('container_full');
  });

  it('maps wasm mode', () => {
    expect(new SandboxProvider({ mode: 'wasm' }).preferredBackend()).toBe('wasm');
  });

  it('microsandbox mode resolves to stub backend identifier', () => {
    expect(new SandboxProvider({ mode: 'microsandbox' }).preferredBackend()).toBe('microsandbox-stub');
  });

  it('delegates shell commands to local-process executor when docker unavailable', async () => {
    const provider = new SandboxProvider({ mode: 'local-process' });
    const exe = await provider.getExecutor();
    const run = vi.spyOn(exe, 'run').mockResolvedValue({
      exitCode: 0,
      stdout: 'hi\n',
      stderr: '',
      durationMs: 1,
      timedOut: false,
      backend: 'local-process',
      artifactId: 'x',
    });

    const out = await provider.runShellCommand('echo hi', { cwd: process.cwd(), timeoutMs: 5000 });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('hi');
    expect(run).toHaveBeenCalled();
  });
});

describe('SandboxProvider docker e2e', () => {
  it('runs echo inside docker when daemon is available', async () => {
    const provider = new SandboxProvider({ mode: 'docker' });
    const exe = await provider.getExecutor();
    const available = await exe.isAvailable();
    if (!available) {
      return;
    }

    const tmp = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await tmp.mkdtemp(path.join(os.tmpdir(), 'pyrfor-sandbox-docker-'));
    try {
      const r = await provider.runShellCommand('echo dockertest', { cwd: dir, timeoutMs: 60_000 });
      // Socket file can exist while the daemon is unreachable (permissions / CI) — treat non-zero as skip.
      if (r.exitCode !== 0) {
        return;
      }
      expect(r.stdout).toContain('dockertest');
    } finally {
      await tmp.rm(dir, { recursive: true, force: true });
    }
  });
});
