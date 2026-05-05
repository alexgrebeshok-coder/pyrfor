export interface GitHubDeliveryReadiness {
    checkedAt: string;
    statusSource: 'local-config';
    liveProbeSkipped: true;
    approvalRequired: true;
    status: 'ready' | 'unavailable';
    tokenConfigured: boolean;
    tokenEnvVar: 'PYRFOR_GITHUB_TOKEN' | 'GITHUB_TOKEN' | 'GH_TOKEN' | null;
    git: {
        available: boolean;
        branch: string | null;
        headSha: string | null;
        dirtyFileCount: number;
    };
    github: {
        repository: string | null;
        remoteConfigured: boolean;
    };
    reasons: string[];
    nextStep: string;
}
export declare function getGitHubDeliveryReadiness(workspace: string, env?: NodeJS.ProcessEnv, now?: () => Date): Promise<GitHubDeliveryReadiness>;
//# sourceMappingURL=github-delivery-readiness.d.ts.map