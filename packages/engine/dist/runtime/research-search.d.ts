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
export declare function normalizeResearchSearchInput(input: GovernedResearchSearchInput): {
    query: string;
    maxResults: number;
};
export declare function resolveGovernedResearchSearchProvider(env?: NodeJS.ProcessEnv): ResearchSearchProvider;
export declare function runGovernedResearchSearch(input: GovernedResearchSearchInput, opts?: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
}): Promise<GovernedResearchSearchResult>;
//# sourceMappingURL=research-search.d.ts.map