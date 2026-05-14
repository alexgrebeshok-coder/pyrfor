import type { ContainerSandboxTier, ISandboxExecutor, SandboxResult, SandboxRunOptions } from './sandbox-executor';
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
export type DockerCommandRunner = (args: string[], options: Pick<SandboxRunOptions, 'timeoutMs' | 'maxOutputBytes'>) => Promise<DockerCommandResult>;
export declare class DockerSandboxBackend implements ISandboxExecutor {
    readonly backend: ContainerSandboxTier;
    private readonly runner;
    constructor(tier?: ContainerSandboxTier, runner?: DockerCommandRunner);
    isAvailable(): Promise<boolean>;
    run(options: SandboxRunOptions): Promise<SandboxResult>;
}
export declare function buildDockerRunSpec(tier: ContainerSandboxTier, options: SandboxRunOptions): DockerRunSpec;
export declare function validateContainerNetworkPolicy(tier: ContainerSandboxTier, options: Pick<SandboxRunOptions, 'networkAllowlist' | 'networkEnabled' | 'requestedEgress'>): DockerRunSpec['egressPolicy'];
//# sourceMappingURL=docker-sandbox-backend.d.ts.map