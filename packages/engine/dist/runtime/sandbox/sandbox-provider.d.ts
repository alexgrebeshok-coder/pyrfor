import { type ISandboxExecutor, type SandboxBackend } from '../universal/sandbox-executor';
import type { SandboxRuntimeConfig } from './types';
export declare class SandboxProvider {
    private readonly cfg;
    private executorPromise;
    constructor(cfg: SandboxRuntimeConfig);
    get config(): SandboxRuntimeConfig;
    resetExecutorCache(): void;
    /** Resolve universal backend preference from runtime mode */
    preferredBackend(): SandboxBackend | undefined;
    getExecutor(): Promise<ISandboxExecutor>;
    /**
     * Run a shell one-liner inside the sandbox backend with `cwd` mounted / used as workdir.
     */
    runShellCommand(command: string, opts: {
        cwd: string;
        timeoutMs?: number;
        maxOutputBytes?: number;
    }): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>;
}
export declare function createSandboxProvider(cfg: SandboxRuntimeConfig): SandboxProvider | null;
//# sourceMappingURL=sandbox-provider.d.ts.map