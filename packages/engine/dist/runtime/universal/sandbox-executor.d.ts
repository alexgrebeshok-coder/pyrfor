export type ContainerSandboxTier = 'container_no_net' | 'container_net_allowlist' | 'container_full';
export type SandboxBackend = 'local-process' | 'docker' | 'wasm' | ContainerSandboxTier;
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
export declare class LocalProcessBackend implements ISandboxExecutor {
    readonly backend: "local-process";
    isAvailable(): Promise<boolean>;
    run(options: SandboxRunOptions): Promise<SandboxResult>;
}
export declare function createSandboxExecutor(preferred?: SandboxBackend): Promise<ISandboxExecutor>;
//# sourceMappingURL=sandbox-executor.d.ts.map