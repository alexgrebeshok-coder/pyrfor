import { chmod, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createSandboxExecutor,
  type ISandboxExecutor,
  type SandboxBackend,
} from '../universal/sandbox-executor';
import type { SandboxRuntimeConfig } from './types';
import { MicrosandboxStubBackend } from './adapters/microsandbox-stub';

function isDockerTierBackend(backend: string): boolean {
  return (
    backend === 'docker'
    || backend === 'container_no_net'
    || backend === 'container_net_allowlist'
    || backend === 'container_full'
  );
}

/** Safe single-quoted literal for POSIX sh */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class SandboxProvider {
  private executorPromise: Promise<ISandboxExecutor> | null = null;

  constructor(private readonly cfg: SandboxRuntimeConfig) {}

  get config(): SandboxRuntimeConfig {
    return this.cfg;
  }

  resetExecutorCache(): void {
    this.executorPromise = null;
  }

  /** Resolve universal backend preference from runtime mode */
  preferredBackend(): SandboxBackend | undefined {
    switch (this.cfg.mode) {
      case 'none':
        return undefined;
      case 'local-process':
        return 'local-process';
      case 'docker':
        return this.cfg.dockerTier ?? 'docker';
      case 'wasm':
        return 'wasm';
      case 'microsandbox':
        return 'microsandbox-stub';
      default:
        return undefined;
    }
  }

  async getExecutor(): Promise<ISandboxExecutor> {
    if (!this.executorPromise) {
      const backend = this.preferredBackend();
      if (this.cfg.mode === 'microsandbox') {
        this.executorPromise = Promise.resolve(new MicrosandboxStubBackend());
      } else {
        this.executorPromise = createSandboxExecutor(backend);
      }
    }
    return await this.executorPromise;
  }

  /**
   * Run a shell one-liner inside the sandbox backend with `cwd` mounted / used as workdir.
   */
  async runShellCommand(
    command: string,
    opts: { cwd: string; timeoutMs?: number; maxOutputBytes?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    const exe = await this.getExecutor();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxOutputBytes = opts.maxOutputBytes ?? 2 * 1024 * 1024;

    const runOpts = {
      workdir: opts.cwd,
      timeoutMs,
      maxOutputBytes,
      image: this.cfg.dockerImage,
    };

    if (isDockerTierBackend(exe.backend)) {
      const scriptPath = path.join(opts.cwd, `.pyrfor-sbx-${randomUUID().slice(0, 8)}.sh`);
      const body = `#!/bin/sh
set -e
exec /bin/sh -c ${shellSingleQuote(command)}
`;
      await writeFile(scriptPath, body, 'utf8');
      await chmod(scriptPath, 0o755);
      try {
        const result = await exe.run({
          implPath: scriptPath,
          args: [],
          ...runOpts,
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
        };
      } finally {
        await unlink(scriptPath).catch(() => {});
      }
    }

    const useWindows = process.platform === 'win32';
    const implPath = useWindows ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';
    const args = useWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
    const result = await exe.run({
      implPath,
      args,
      ...runOpts,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }
}

export function createSandboxProvider(cfg: SandboxRuntimeConfig): SandboxProvider | null {
  if (!cfg || cfg.mode === 'none') return null;
  return new SandboxProvider(cfg);
}
