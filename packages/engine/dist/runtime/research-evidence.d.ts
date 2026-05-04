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
export interface ResearchEvidenceSnapshot {
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
export declare function createResearchEvidenceSnapshot(runId: string, input: ResearchEvidenceInput, now?: () => Date): ResearchEvidenceSnapshot;
//# sourceMappingURL=research-evidence.d.ts.map