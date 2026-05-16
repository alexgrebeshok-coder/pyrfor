import type { ISandboxExecutor, SandboxResult, SandboxRunOptions } from '../../universal/sandbox-executor';

/**
 * Placeholder until a packaged microsandbox / sidecar exists.
 */
export class MicrosandboxStubBackend implements ISandboxExecutor {
  readonly backend = 'microsandbox-stub' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async run(_options: SandboxRunOptions): Promise<SandboxResult> {
    throw new Error(
      'Sandbox mode "microsandbox" is not implemented yet (requires sidecar packaging).',
    );
  }
}
