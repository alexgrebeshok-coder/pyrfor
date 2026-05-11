import type { ISandboxExecutor, SandboxResult, SandboxRunOptions } from './sandbox-executor';

export class WasmSandboxBackend implements ISandboxExecutor {
  readonly backend = 'wasm' as const;

  async isAvailable(): Promise<boolean> {
    return typeof WebAssembly !== 'undefined';
  }

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    void options;
    throw new Error(
      'WasmSandboxBackend.run() is not yet implemented. Full WASM execution is deferred to the sandbox backend extraction milestone.',
    );
  }
}
