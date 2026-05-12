import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDockerRunSpec,
  DockerSandboxBackend,
  validateContainerNetworkPolicy,
  type DockerCommandRunner,
} from './docker-sandbox-backend';
import { createSandboxExecutor } from './sandbox-executor';

describe('DockerSandboxBackend', () => {
  let workdir: string;
  let scriptPath: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'pyrfor-docker-sandbox-'));
    scriptPath = path.join(workdir, 'tool.js');
    writeFileSync(scriptPath, 'console.log("ok")', 'utf8');
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('defaults to container_no_net tier', () => {
    expect(new DockerSandboxBackend().backend).toBe('container_no_net');
  });

  it('isAvailable() returns a boolean without dockerode', async () => {
    const available = await new DockerSandboxBackend().isAvailable();

    expect(typeof available).toBe('boolean');
  });

  it('builds container_no_net docker args with network disabled', () => {
    const spec = buildDockerRunSpec('container_no_net', { implPath: scriptPath, workdir });

    expect(spec).toMatchObject({
      tier: 'container_no_net',
      networkMode: 'none',
      egressPolicy: 'disabled',
    });
    expect(spec.args).toEqual(expect.arrayContaining(['--network', 'none', '--read-only']));
    expect(spec.args).toContain('/workspace/tool.js');
  });

  it('keeps container_net_allowlist network-disabled while enforcing declared egress allowlist', () => {
    const spec = buildDockerRunSpec('container_net_allowlist', {
      implPath: scriptPath,
      workdir,
      networkAllowlist: ['api.example.com'],
      requestedEgress: ['https://api.example.com/v1/search'],
    });

    expect(spec.networkMode).toBe('none');
    expect(spec.egressPolicy).toBe('allowlist_enforced');
    expect(spec.args).toEqual(expect.arrayContaining([
      'PYRFOR_EGRESS_ALLOWLIST=api.example.com',
    ]));
  });

  it('blocks egress outside the allowlist before docker is invoked', () => {
    expect(() => validateContainerNetworkPolicy('container_net_allowlist', {
      networkAllowlist: ['api.example.com'],
      requestedEgress: ['https://evil.example.net'],
    })).toThrow(/outside allowlist/);
  });

  it('blocks any requested egress in container_no_net', () => {
    expect(() => validateContainerNetworkPolicy('container_no_net', {
      requestedEgress: ['https://api.example.com'],
    })).toThrow(/forbids network egress/);
  });

  it('uses bridge networking only for container_full', () => {
    const spec = buildDockerRunSpec('container_full', { implPath: scriptPath, workdir });

    expect(spec.networkMode).toBe('bridge');
    expect(spec.egressPolicy).toBe('full');
  });

  it('rejects implPath outside the mounted workdir', () => {
    expect(() => buildDockerRunSpec('container_no_net', {
      implPath: process.execPath,
      workdir,
    })).toThrow(/implPath must be inside workdir/);
  });

  it('run() delegates to the injected docker command runner', async () => {
    const runner: DockerCommandRunner = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      durationMs: 12,
      timedOut: false,
    }));
    const backend = new DockerSandboxBackend('container_no_net', runner);

    const result = await backend.run({ implPath: scriptPath, workdir });

    expect(result).toMatchObject({
      backend: 'container_no_net',
      exitCode: 0,
      stdout: 'ok\n',
      timedOut: false,
    });
    expect(result.artifactId).toMatch(/^sandbox:/);
    expect(runner).toHaveBeenCalledWith(expect.arrayContaining(['run', '--rm']), {
      timeoutMs: undefined,
      maxOutputBytes: undefined,
    });
  });

  it('createSandboxExecutor("container_net_allowlist") returns a tiered docker backend', async () => {
    const executor = await createSandboxExecutor('container_net_allowlist');

    expect(executor.backend).toBe('container_net_allowlist');
  });

  it('createSandboxExecutor("docker") remains a safe alias for container_no_net', async () => {
    const executor = await createSandboxExecutor('docker');

    expect(executor.backend).toBe('container_no_net');
  });

  it('createSandboxExecutor() without args still returns local-process', async () => {
    const executor = await createSandboxExecutor();

    expect(executor.backend).toBe('local-process');
  });
});
