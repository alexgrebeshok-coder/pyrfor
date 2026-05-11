import { describe, expect, it } from 'vitest';
import { DockerSandboxBackend } from './docker-sandbox-backend';
import { createSandboxExecutor } from './sandbox-executor';

describe('DockerSandboxBackend', () => {
  it('reports backend as docker', () => {
    expect(new DockerSandboxBackend().backend).toBe('docker');
  });

  it('isAvailable() returns a boolean without dockerode', async () => {
    const available = await new DockerSandboxBackend().isAvailable();

    expect(typeof available).toBe('boolean');
  });

  it('run() rejects with an explicit deferral error', async () => {
    await expect(
      new DockerSandboxBackend().run({ implPath: '/fake/script.ts', workdir: '/tmp' }),
    ).rejects.toThrow(/not yet implemented/i);
  });

  it('createSandboxExecutor("docker") returns the docker backend', async () => {
    const executor = await createSandboxExecutor('docker');

    expect(executor.backend).toBe('docker');
  });

  it('createSandboxExecutor() without args still returns local-process', async () => {
    const executor = await createSandboxExecutor();

    expect(executor.backend).toBe('local-process');
  });
});
