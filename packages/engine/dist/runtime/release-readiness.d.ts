export declare const RELEASE_SECRET_ENV_VARS: readonly ["APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE_P12", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_TEAM_ID", "APPLE_PASSWORD", "TAURI_SIGNING_PRIVATE_KEY"];
export declare const RELEASE_SIDECAR_ARTIFACTS: readonly ["pyrfor-daemon-aarch64-apple-darwin", "_runtime/node", "_app/bin/pyrfor.cjs", "_app/dist/runtime/gateway.js", "_app/dist/runtime/cli.js", "_app/node_modules/server-only/index.js"];
export type ReleaseSecretEnvVar = typeof RELEASE_SECRET_ENV_VARS[number];
export interface ReleaseReadiness {
    checkedAt: string;
    statusSource: 'local-config';
    liveProbeSkipped: true;
    approvalRequired: true;
    status: 'ready' | 'unavailable';
    secrets: Array<{
        name: ReleaseSecretEnvVar;
        configured: boolean;
    }>;
    artifacts: Array<{
        name: typeof RELEASE_SIDECAR_ARTIFACTS[number];
        present: boolean;
    }>;
    contracts: Array<{
        id: string;
        passed: boolean;
        description: string;
    }>;
    reasons: string[];
    nextStep: string;
}
export interface ReleaseReadinessOptions {
    root?: string;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
}
export declare function getReleaseReadiness(options?: ReleaseReadinessOptions): ReleaseReadiness;
export declare function resolveReleaseReadinessRoot(startPathOrUrl?: string): string;
//# sourceMappingURL=release-readiness.d.ts.map