import type { AIRunTrace } from "@/lib/ai/trace";
import type { AIActionProposal, AIApplyResult, AIRunRecord } from "@/lib/ai/types";
import type {
  EvidenceFusionFactView,
  EvidenceListResult,
  EvidenceRecordView,
} from "@/lib/evidence";
import type { WorkReportView } from "@/lib/work-reports/types";

export interface WorkflowAuditPackCandidate {
  runId: string;
  packetId: string | null;
  packetLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  purpose: string | null;
  purposeLabel: string | null;
  sourceEntityId: string;
  sourceEntityLabel: string;
  status: AIRunRecord["status"];
  proposalState: AIActionProposal["state"] | null;
  hasAppliedDecision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowAuditPackScope {
  workflow: string;
  generatedAt: string;
  runId: string;
  packetId: string | null;
  packetLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceEntityLabel: string;
}

export interface WorkflowAuditPackDecisionContext {
  status: "applied" | "dismissed" | "pending" | "none";
  proposal: AIActionProposal | null;
  applyResult: AIApplyResult | null;
  operatorSummary: string;
}

export interface WorkflowAuditPackArtifact {
  content: string;
  fileName: string;
  format: "markdown";
  mediaType: "text/markdown";
}

export interface WorkflowAuditPackSourceLink {
  href: string;
  label: string;
}

export interface WorkflowAuditPack {
  artifact: WorkflowAuditPackArtifact;
  corroborationFacts: EvidenceFusionFactView[];
  decision: WorkflowAuditPackDecisionContext;
  evidence: {
    records: EvidenceRecordView[];
    summary: EvidenceListResult["summary"];
    sync: EvidenceListResult["sync"];
  };
  scope: WorkflowAuditPackScope;
  sourceLinks: WorkflowAuditPackSourceLink[];
  trace: AIRunTrace;
  workReport: WorkReportView | null;
}

