export { analyzeEvidenceRecord } from "@/lib/evidence/analysis";
export {
  getEvidenceLedgerOverview,
  getEvidenceRecordById,
  mapGpsSnapshotToEvidenceInputs,
  mapWorkReportToEvidenceInput,
  removeEvidenceRecordForEntity,
  summarizeEvidenceRecords,
  syncEvidenceLedger,
  syncWorkReportEvidenceRecord,
} from "@/lib/evidence/service";
export { getEvidenceFusionOverview, buildEvidenceFusionFacts } from "@/lib/evidence/fusion";
export type {
  EvidenceAnalysisItem,
  EvidenceAnalysisMatch,
  EvidenceAnalysisResult,
  EvidenceFusionFactView,
  EvidenceFusionOverview,
  EvidenceFusionQuery,
  EvidenceFusionSourceView,
  EvidenceFusionSummary,
  EvidenceListResult,
  EvidenceMetadata,
  EvidenceQuery,
  EvidenceRecordView,
  EvidenceSummary,
  EvidenceUpsertInput,
  EvidenceVerificationStatus,
} from "@/lib/evidence/types";
