export interface ResearchEvidenceSourceInput {
    url: string;
    title?: string;
    snippet?: string;
    citation?: string;
    observedAt?: string;
}
export interface ResearchEvidenceInput {
    query: string;
    sources: ResearchEvidenceSourceInput[];
    summary?: string;
    conclusion?: string;
    notes?: string[];
}
export interface ResearchEvidenceSource {
    url: string;
    title?: string;
    snippet?: string;
    citation?: string;
    observedAt?: string;
}
export type ResearchSearchProvider = 'brave' | 'duckduckgo';
export interface ResearchEvidenceWebSearchEffect {
    kind: 'web_search';
    provider: ResearchSearchProvider;
    approvalId: string;
    executedAt: string;
    maxResults: number;
    resultCount: number;
}
export interface OperatorResearchEvidenceSnapshot {
    schemaVersion: 'pyrfor.research_evidence.v1';
    createdAt: string;
    runId: string;
    query: string;
    queryHash: string;
    sourceMode: 'operator_supplied';
    effectsExecuted: [];
    sources: ResearchEvidenceSource[];
    summary?: string;
    conclusion?: string;
    notes: string[];
}
export interface GovernedSearchResearchEvidenceSnapshot {
    schemaVersion: 'pyrfor.research_evidence.v2';
    createdAt: string;
    runId: string;
    query: string;
    queryHash: string;
    sourceMode: 'governed_search';
    effectsExecuted: [ResearchEvidenceWebSearchEffect];
    sources: ResearchEvidenceSource[];
    summary?: string;
    conclusion?: string;
    notes: string[];
}
export type ResearchEvidenceSnapshot = OperatorResearchEvidenceSnapshot | GovernedSearchResearchEvidenceSnapshot;
export declare function createResearchEvidenceSnapshot(runId: string, input: ResearchEvidenceInput, now?: () => Date): OperatorResearchEvidenceSnapshot;
export declare function createGovernedSearchResearchEvidenceSnapshot(runId: string, input: {
    query: string;
    notes?: string[];
    approvalId: string;
    provider: ResearchSearchProvider;
    maxResults: number;
    executedAt: string;
    results: ResearchEvidenceSourceInput[];
}, now?: () => Date): GovernedSearchResearchEvidenceSnapshot;
//# sourceMappingURL=research-evidence.d.ts.map