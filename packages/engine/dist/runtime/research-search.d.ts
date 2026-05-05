import type { ResearchEvidenceSourceInput, ResearchSearchProvider } from './research-evidence';
export interface GovernedResearchSearchInput {
    query: string;
    maxResults?: number;
    provider?: ResearchSearchProvider;
}
export interface GovernedResearchSearchResult {
    provider: ResearchSearchProvider;
    executedAt: string;
    maxResults: number;
    results: ResearchEvidenceSourceInput[];
}
export interface GovernedResearchSearchReadinessProvider {
    provider: ResearchSearchProvider;
    configured: boolean;
    missingEnv: string[];
    readiness: {
        state: 'configured' | 'pending';
        reasons: string[];
        nextStep: string;
    };
}
export interface GovernedResearchSearchReadiness {
    checkedAt: string;
    statusSource: 'local-config';
    liveProbeSkipped: true;
    approvalRequired: true;
    status: 'ready' | 'unavailable';
    defaultProvider: ResearchSearchProvider | null;
    configuredProvider: ResearchSearchProvider | null;
    allowedProviders: ResearchSearchProvider[];
    reasons: string[];
    nextStep: string;
    providers: GovernedResearchSearchReadinessProvider[];
}
export declare function normalizeResearchSearchInput(input: GovernedResearchSearchInput): {
    query: string;
    maxResults: number;
};
export declare function resolveGovernedResearchSearchProvider(env?: NodeJS.ProcessEnv): ResearchSearchProvider;
export declare function getGovernedResearchSearchReadiness(env?: NodeJS.ProcessEnv, now?: () => Date): GovernedResearchSearchReadiness;
export declare function runGovernedResearchSearch(input: GovernedResearchSearchInput, opts?: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
}): Promise<GovernedResearchSearchResult>;
//# sourceMappingURL=research-search.d.ts.map