import type { EvidenceFusionFactView, EvidenceFusionOverview, EvidenceFusionQuery, EvidenceListResult, EvidenceQuery, EvidenceRecordView } from "./types";
interface EvidenceFusionDeps {
    evidence?: EvidenceListResult;
    getEvidence?: (query: EvidenceQuery) => Promise<EvidenceListResult>;
    now?: () => Date;
}
export declare function getEvidenceFusionOverview(query?: EvidenceFusionQuery, deps?: EvidenceFusionDeps): Promise<EvidenceFusionOverview>;
export declare function buildEvidenceFusionFacts(records: EvidenceRecordView[]): EvidenceFusionFactView[];
export {};
//# sourceMappingURL=fusion.d.ts.map