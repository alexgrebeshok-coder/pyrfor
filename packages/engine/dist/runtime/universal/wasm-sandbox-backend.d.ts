import type { ISandboxExecutor, SandboxResult, SandboxRunOptions } from './sandbox-executor';
export declare class WasmSandboxBackend implements ISandboxExecutor {
    readonly backend: "wasm";
    isAvailable(): Promise<boolean>;
    run(options: SandboxRunOptions): Promise<SandboxResult>;
}
//# sourceMappingURL=wasm-sandbox-backend.d.ts.map