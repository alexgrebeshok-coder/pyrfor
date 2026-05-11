import { existsSync } from 'node:fs';
import type { ISandboxExecutor, SandboxResult, SandboxRunOptions } from './sandbox-executor';

const DOCKER_SOCKETS = [
  '/var/run/docker.sock',
  '\\\\.\\pipe\\docker_engine',
];

export class DockerSandboxBackend implements ISandboxExecutor {
  readonly backend = 'docker' as const;

  async isAvailable(): Promise<boolean> {
    return DOCKER_SOCKETS.some((socket) => existsSync(socket));
  }

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    void options;
    throw new Error(
      'DockerSandboxBackend.run() is not yet implemented. Full container execution is deferred to the sandbox backend extraction milestone.',
    );
  }
}
