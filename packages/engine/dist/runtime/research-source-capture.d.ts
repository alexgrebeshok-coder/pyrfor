export interface ResearchSourceCaptureInput {
    url: string;
    approvalId?: string;
    note?: string;
}
export interface NormalizedResearchSourceCaptureInput {
    url: string;
    publicUrl: string;
    urlHash: string;
    host: string;
    pathHash: string;
    note?: string;
}
export interface ResearchSourceCaptureSnapshot {
    schemaVersion: 'pyrfor.research_source_capture.v1';
    createdAt: string;
    runId: string;
    sourceMode: 'governed_source_capture';
    requestedUrl: string;
    requestedUrlHash: string;
    requestedHost: string;
    requestedPathHash: string;
    finalUrl: string;
    finalUrlHash: string;
    finalHost: string;
    statusCode: number;
    contentType: string;
    title?: string;
    contentHash: string;
    capturedBytes: number;
    truncated: boolean;
    excerpt: string;
    note?: string;
    effectsExecuted: [
        {
            kind: 'research_source_capture';
            approvalId: string;
            executedAt: string;
            requestedUrlHash: string;
            finalUrlHash: string;
        }
    ];
}
export interface ResearchSourceCaptureArtifactDocument {
    snapshot: ResearchSourceCaptureSnapshot;
    contentText: string;
}
export interface ResearchSourceCaptureResult {
    normalized: NormalizedResearchSourceCaptureInput;
    snapshot: ResearchSourceCaptureSnapshot;
    artifactDocument: ResearchSourceCaptureArtifactDocument;
}
type ResolveHostname = (hostname: string) => Promise<Array<{
    address: string;
    family?: number;
}>>;
export declare function normalizeResearchSourceCaptureInput(input: ResearchSourceCaptureInput): NormalizedResearchSourceCaptureInput;
export declare function buildResearchSourceCaptureApprovalId(input: NormalizedResearchSourceCaptureInput, runId: string): string;
export declare function runResearchSourceCapture(runId: string, input: ResearchSourceCaptureInput & {
    approvalId: string;
}, opts?: {
    fetchImpl?: typeof fetch;
    resolveHostname?: ResolveHostname;
    timeoutMs?: number;
    now?: () => Date;
}): Promise<ResearchSourceCaptureResult>;
export {};
//# sourceMappingURL=research-source-capture.d.ts.map