import type { EvidenceAnalysisResult, EvidenceFusionOverview, EvidenceRecordView } from "./types";
interface EvidenceAnalysisDeps {
    loadFusion?: (query?: {
        limit?: number;
        projectId?: string;
    }) => Promise<EvidenceFusionOverview>;
    loadRecord?: (recordId: string) => Promise<EvidenceRecordView | null>;
}
export declare function analyzeEvidenceRecord(recordId: string, deps?: EvidenceAnalysisDeps): Promise<EvidenceAnalysisResult | null>;
export {};
//# sourceMappingURL=analysis.d.ts.map