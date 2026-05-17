import type { ContainerSandboxTier } from '../universal/sandbox-executor';
/**
 * Runtime sandbox tier — maps to universal backends via {@link SandboxProvider}.
 *
 * `local-process` is dev-only: commands run on the host with cwd binding only.
 * It does not provide production isolation (use `docker` or future `microsandbox`).
 */
export type SandboxMode = 'none' | 'local-process' | 'docker' | 'wasm' | 'microsandbox';
export interface SandboxRuntimeConfig {
    mode: SandboxMode;
    /** Passed to Docker-backed tiers as the container image */
    dockerImage?: string;
    /** When mode is docker, selects container network posture */
    dockerTier?: Exclude<ContainerSandboxTier, never>;
}
//# sourceMappingURL=types.d.ts.map