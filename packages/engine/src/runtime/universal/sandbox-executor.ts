import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type ContainerSandboxTier = 'container_no_net' | 'container_net_allowlist' | 'container_full';
export type SandboxBackend =
  | 'local-process'
  | 'docker'
  | 'wasm'
  | 'microsandbox-stub'
  | ContainerSandboxTier;

export interface SandboxRunOptions {
  implPath: string;
  args?: string[];
  workdir: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  networkEnabled?: boolean;
  networkAllowlist?: string[];
  requestedEgress?: string[];
  image?: string;
  containerUser?: string;
  readonlyRootfs?: boolean;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  backend: SandboxBackend;
  artifactId: string;
}

export interface ISandboxExecutor {
  readonly backend: SandboxBackend;
  isAvailable(): Promise<boolean>;
  run(options: SandboxRunOptions): Promise<SandboxResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PATH = '/usr/bin:/bin';

export class LocalProcessBackend implements ISandboxExecutor {
  readonly backend = 'local-process' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const args = options.args ?? [];
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let timedOut = false;
    let killedForOutput = false;

    return new Promise<SandboxResult>((resolve) => {
      const child: ChildProcessWithoutNullStreams = spawn(options.implPath, args, {
        cwd: options.workdir,
        env: buildSandboxEnv(options.env),
        detached: true,
        shell: false,
      });

      const finish = (exitCode: number): void => {
        resolve({
          exitCode,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          durationMs: Date.now() - startedAt,
          timedOut,
          backend: this.backend,
          artifactId: `sandbox:${randomUUID()}`,
        });
      };

      const killGroup = (): void => {
        if (child.pid === undefined || child.killed) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, maxOutputBytes);
        if (stdout.byteLength >= maxOutputBytes && !killedForOutput) {
          killedForOutput = true;
          killGroup();
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, maxOutputBytes);
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeout);
        stderr = appendCapped(stderr, Buffer.from(error.message), maxOutputBytes);
        finish(127);
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeout);
        if (timedOut) {
          finish(code ?? 124);
          return;
        }
        if (killedForOutput) {
          finish(code ?? 137);
          return;
        }
        if (code !== null) {
          finish(code);
          return;
        }
        finish(signal ? 128 : 1);
      });
    });
  }
}

export async function createSandboxExecutor(preferred?: SandboxBackend): Promise<ISandboxExecutor> {
  if (preferred === 'wasm') {
    const { WasmSandboxBackend } = await import('./wasm-sandbox-backend.js');
    return new WasmSandboxBackend();
  }
  if (
    preferred === 'docker' ||
    preferred === 'container_no_net' ||
    preferred === 'container_net_allowlist' ||
    preferred === 'container_full'
  ) {
    const { DockerSandboxBackend } = await import('./docker-sandbox-backend.js');
    return new DockerSandboxBackend(preferred === 'docker' ? 'container_no_net' : preferred);
  }
  return new LocalProcessBackend();
}

function buildSandboxEnv(input?: Record<string, string>): NodeJS.ProcessEnv {
  const { NODE_ENV, ...rest } = input ?? {};
  return {
    PATH: DEFAULT_PATH,
    ...rest,
    NODE_ENV: normalizeNodeEnv(NODE_ENV ?? 'test'),
  };
}

function normalizeNodeEnv(value: string): NodeJS.ProcessEnv['NODE_ENV'] {
  if (value === 'development' || value === 'production' || value === 'test') return value;
  return 'test';
}

function appendCapped(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  maxBytes: number,
): Buffer<ArrayBufferLike> {
  if (maxBytes <= 0) return Buffer.alloc(0);
  const remaining = maxBytes - current.byteLength;
  if (remaining <= 0) return current;
  return Buffer.concat([current, chunk.subarray(0, remaining)]);
}
