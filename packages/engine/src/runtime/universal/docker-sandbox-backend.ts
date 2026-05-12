import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ContainerSandboxTier, ISandboxExecutor, SandboxResult, SandboxRunOptions } from './sandbox-executor';

const DOCKER_SOCKETS = [
  '/var/run/docker.sock',
  '\\\\.\\pipe\\docker_engine',
];

const DEFAULT_IMAGE = 'node:20-alpine';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const CONTAINER_WORKDIR = '/workspace';

export interface DockerRunSpec {
  tier: ContainerSandboxTier;
  args: string[];
  networkMode: 'none' | 'bridge';
  egressPolicy: 'disabled' | 'allowlist_enforced' | 'full';
}

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type DockerCommandRunner = (
  args: string[],
  options: Pick<SandboxRunOptions, 'timeoutMs' | 'maxOutputBytes'>,
) => Promise<DockerCommandResult>;

export class DockerSandboxBackend implements ISandboxExecutor {
  readonly backend: ContainerSandboxTier;
  private readonly runner: DockerCommandRunner;

  constructor(tier: ContainerSandboxTier = 'container_no_net', runner: DockerCommandRunner = runDockerCommand) {
    this.backend = tier;
    this.runner = runner;
  }

  async isAvailable(): Promise<boolean> {
    return DOCKER_SOCKETS.some((socket) => existsSync(socket));
  }

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    const spec = buildDockerRunSpec(this.backend, options);
    const result = await this.runner(spec.args, {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
    });
    return {
      ...result,
      backend: this.backend,
      artifactId: `sandbox:${randomUUID()}`,
    };
  }
}

export function buildDockerRunSpec(tier: ContainerSandboxTier, options: SandboxRunOptions): DockerRunSpec {
  const egressPolicy = validateContainerNetworkPolicy(tier, options);
  const networkMode = tier === 'container_full' ? 'bridge' : 'none';
  const image = options.image ?? DEFAULT_IMAGE;
  const containerImplPath = toContainerPath(options.implPath, options.workdir);

  const args = [
    'run',
    '--rm',
    '--network',
    networkMode,
    '--workdir',
    CONTAINER_WORKDIR,
    '--volume',
    `${realpathSync(options.workdir)}:${CONTAINER_WORKDIR}:rw`,
    '--env',
    `PYRFOR_SANDBOX_TIER=${tier}`,
    '--env',
    `PYRFOR_EGRESS_ALLOWLIST=${(options.networkAllowlist ?? []).join(',')}`,
  ];

  if (options.containerUser) args.push('--user', options.containerUser);
  if (options.readonlyRootfs ?? true) args.push('--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');

  args.push(image, containerImplPath, ...(options.args ?? []));
  return { tier, args, networkMode, egressPolicy };
}

export function validateContainerNetworkPolicy(
  tier: ContainerSandboxTier,
  options: Pick<SandboxRunOptions, 'networkAllowlist' | 'networkEnabled' | 'requestedEgress'>,
): DockerRunSpec['egressPolicy'] {
  const requested = options.requestedEgress ?? [];
  if (tier === 'container_no_net') {
    if (options.networkEnabled || requested.length > 0) {
      throw new Error('DockerSandboxBackend: container_no_net forbids network egress');
    }
    return 'disabled';
  }

  if (tier === 'container_net_allowlist') {
    const allowlist = options.networkAllowlist ?? [];
    for (const target of requested) {
      if (!isEgressTargetAllowed(target, allowlist)) {
        throw new Error(`DockerSandboxBackend: egress target outside allowlist: ${target}`);
      }
    }
    return 'allowlist_enforced';
  }

  return 'full';
}

function toContainerPath(implPath: string, workdir: string): string {
  const realWorkdir = realpathSync(workdir);
  const resolvedImpl = realpathSync(implPath);
  const relative = path.relative(realWorkdir, resolvedImpl);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`DockerSandboxBackend: implPath must be inside workdir: ${implPath}`);
  }
  return path.posix.join(CONTAINER_WORKDIR, relative.split(path.sep).join('/'));
}

function isEgressTargetAllowed(target: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  let host: string;
  try {
    host = new URL(target).host;
  } catch {
    host = target;
  }
  return allowlist.includes(host);
}

async function runDockerCommand(args: string[], options: Pick<SandboxRunOptions, 'timeoutMs' | 'maxOutputBytes'>): Promise<DockerCommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let timedOut = false;
  let killedForOutput = false;

  return new Promise<DockerCommandResult>((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawn('docker', args, {
      detached: true,
      shell: false,
    });

    const killGroup = (): void => {
      if (child.pid === undefined || child.killed) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };

    const finish = (exitCode: number): void => {
      resolve({
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
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
