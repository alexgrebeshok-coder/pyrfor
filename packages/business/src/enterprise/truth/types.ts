import type { OneCProjectFinanceSample } from "@/lib/connectors/one-c-client";
import type { GpsTelemetrySample } from "@/lib/connectors/gps-client";
import type {
  EvidenceFusionFactView,
  EvidenceVerificationStatus,
} from "@/lib/evidence";
import type { DerivedSyncCheckpointView } from "@/lib/sync-state";

export type EnterpriseTruthProjectStatus =
  | "corroborated"
  | "field_only"
  | "finance_only";

export interface EnterpriseTruthFinanceView {
  sample: OneCProjectFinanceSample | null;
  variance: number | null;
  variancePercent: number | null;
  reportDate: string | null;
}

export interface EnterpriseTruthFieldView {
  reportCount: number;
  fusedFactCount: number;
  strongestVerificationStatus: EvidenceVerificationStatus | "none";
  latestObservedAt: string | null;
}

export interface EnterpriseTruthProjectView {
  id: string;
  projectId: string | null;
  projectName: string;
  financeProjectId: string | null;
  status: EnterpriseTruthProjectStatus;
  finance: EnterpriseTruthFinanceView;
  field: EnterpriseTruthFieldView;
  explanation: string;
}

export interface EnterpriseTruthTelemetryGapView {
  id: string;
  equipmentId: string | null;
  geofenceName: string | null;
  observedAt: string;
  confidence: number | null;
  explanation: string;
}

export interface EnterpriseTruthSummary {
  totalProjects: number;
  corroborated: number;
  fieldOnly: number;
  financeOnly: number;
  telemetryGaps: number;
  largestVarianceProject: string | null;
}

export interface EnterpriseTruthOverview {
  syncedAt: string;
  summary: EnterpriseTruthSummary;
  projects: EnterpriseTruthProjectView[];
  telemetryGaps: EnterpriseTruthTelemetryGapView[];
}

export interface EnterpriseTruthQuery {
  limit?: number;
  projectId?: string;
  telemetryLimit?: number;
}

export interface EnterpriseTruthTelemetrySource {
  evidenceId?: string;
  evidenceEntityRef?: string;
  sample: GpsTelemetrySample;
}

export interface EnterpriseTruthProjectGroup {
  key: string;
  projectName: string;
  projectId: string | null;
  financeProjectId: string | null;
  financeSample: OneCProjectFinanceSample | null;
  fieldEvidenceIds: string[];
  fusionFacts: EvidenceFusionFactView[];
}

export type ReconciliationCaseTruthStatus =
  | "corroborated"
  | "contradictory"
  | "partial";

export type ReconciliationCaseType = "project_case" | "telemetry_gap";
export type ReconciliationCaseResolutionStatus = "open" | "resolved";

export interface ReconciliationCaseFinanceView {
  projectId: string | null;
  projectName: string | null;
  reportDate: string | null;
  variance: number | null;
  variancePercent: number | null;
  budgetDeltaStatus: string | null;
}

export interface ReconciliationCaseFieldView {
  reportCount: number;
  fusedFactCount: number;
  strongestVerificationStatus: EvidenceVerificationStatus | "none";
  latestObservedAt: string | null;
}

export interface ReconciliationCaseTelemetryView {
  entityRefs: string[];
  equipmentIds: string[];
  geofenceNames: string[];
  latestObservedAt: string | null;
}

export interface ReconciliationCasefileView {
  id: string;
  key: string;
  caseType: ReconciliationCaseType;
  truthStatus: ReconciliationCaseTruthStatus;
  resolutionStatus: ReconciliationCaseResolutionStatus;
  projectId: string | null;
  projectName: string | null;
  financeProjectId: string | null;
  title: string;
  explanation: string;
  reasonCodes: string[];
  evidenceRecordIds: string[];
  fusionFactIds: string[];
  telemetryRefs: string[];
  finance: ReconciliationCaseFinanceView | null;
  field: ReconciliationCaseFieldView | null;
  telemetry: ReconciliationCaseTelemetryView | null;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationCasefileSummary {
  total: number;
  open: number;
  resolved: number;
  corroborated: number;
  contradictory: number;
  partial: number;
  projectCases: number;
  telemetryGaps: number;
}

export interface ReconciliationCasefileListResult {
  syncedAt: string | null;
  summary: ReconciliationCasefileSummary;
  cases: ReconciliationCasefileView[];
  sync: DerivedSyncCheckpointView | null;
}

export interface ReconciliationCasefileQuery {
  caseType?: ReconciliationCaseType;
  limit?: number;
  projectId?: string;
  resolutionStatus?: ReconciliationCaseResolutionStatus;
  truthStatus?: ReconciliationCaseTruthStatus;
}
