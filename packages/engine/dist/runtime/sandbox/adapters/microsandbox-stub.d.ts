import type { ISandboxExecutor, SandboxResult, SandboxRunOptions } from '../../universal/sandbox-executor';
/**
 * Placeholder until a packaged microsandbox / sidecar exists.
 */
export declare class MicrosandboxStubBackend implements ISandboxExecutor {
    readonly backend: "microsandbox-stub";
    isAvailable(): Promise<boolean>;
    run(_options: SandboxRunOptions): Promise<SandboxResult>;
}
//# sourceMappingURL=microsandbox-stub.d.ts.map