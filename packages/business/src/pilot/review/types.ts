import type { AccessProfile } from "@/lib/auth/access-profile";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { ExceptionInboxResult } from "@/lib/command-center";
import type { PilotFeedbackListResult } from "@/lib/pilot-feedback";
import type { ServerRuntimeState } from "@/lib/server/runtime-mode";
import type { DerivedSyncCheckpointView } from "@/lib/sync-state";
import type { TenantReadinessReport, TenantReadinessState } from "@/lib/tenant-readiness";

export type PilotReviewOutcome = "blocked" | "guarded" | "ready" | "ready_with_warnings";
export type PilotReviewSectionId =
  | "readiness"
  | "exceptions"
  | "feedback"
  | "delivery"
  | "freshness";

export interface PilotReviewLinkView {
  href: string;
  label: string;
}

export interface PilotReviewMetric {
  label: string;
  value: string;
}

export interface PilotReviewSection {
  id: PilotReviewSectionId;
  label: string;
  links: PilotReviewLinkView[];
  metrics: PilotReviewMetric[];
  state: TenantReadinessState;
  summary: string;
}

export interface PilotReviewExportArtifact {
  content: string;
  fileName: string;
  format: "markdown";
  mediaType: "text/markdown";
}

export interface PilotReviewFreshnessSignal {
  ageHours: number | null;
  id: string;
  label: string;
  lastSuccessAt: string | null;
  links: PilotReviewLinkView[];
  state: TenantReadinessState;
  status: DerivedSyncCheckpointView["status"] | "missing";
  summary: string;
}

export interface PilotReviewDeliverySummary {
  entries: BriefDeliveryLedgerRecord[];
  failed: number;
  lastDeliveredAt: string | null;
  lastFailureAt: string | null;
  pending: number;
  preview: number;
  stalePending: number;
  successful: number;
  total: number;
}

export interface PilotReviewSummary {
  blockedSections: number;
  deliveryFailures: number;
  openExceptions: number;
  openFeedback: number;
  readySections: number;
  staleSignals: number;
  warningSections: number;
}

export interface PilotReviewScorecard {
  accessProfile: Pick<AccessProfile, "organizationSlug" | "role" | "workspaceId">;
  artifact: PilotReviewExportArtifact;
  delivery: PilotReviewDeliverySummary;
  freshness: PilotReviewFreshnessSignal[];
  generatedAt: string;
  outcome: PilotReviewOutcome;
  outcomeLabel: string;
  readiness: TenantReadinessReport;
  runtime: ServerRuntimeState;
  sections: PilotReviewSection[];
  summary: PilotReviewSummary;
}

export interface PilotReviewBuildInput {
  accessProfile: AccessProfile;
  deliveryEntries: BriefDeliveryLedgerRecord[] | null;
  inbox: ExceptionInboxResult | null;
  freshnessSignals: Array<{
    checkpoint: DerivedSyncCheckpointView | null;
    id: string;
    label: string;
    links: PilotReviewLinkView[];
  }>;
  generatedAt: string;
  pilotFeedback: PilotFeedbackListResult | null;
  readiness: TenantReadinessReport;
  runtime: ServerRuntimeState;
}

export type PilotReviewDeliveryChannel = "email";

export interface PilotReviewDeliveryPolicyRecord {
  active: boolean;
  channel: PilotReviewDeliveryChannel;
  createdAt: string;
  createdByUserId: string | null;
  deliveryHour: number;
  deliveryWeekday: number;
  id: string;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
  recipient: string | null;
  timezone: string;
  updatedAt: string;
  updatedByUserId: string | null;
  workspaceId: string;
}

export interface CreatePilotReviewDeliveryPolicyInput {
  active?: boolean;
  channel?: PilotReviewDeliveryChannel;
  deliveryHour: number;
  deliveryWeekday: number;
  recipient?: string | null;
  timezone: string;
  workspaceId?: string;
  createdByUserId?: string | null;
}

export interface UpdatePilotReviewDeliveryPolicyInput {
  active?: boolean;
  deliveryHour?: number;
  deliveryWeekday?: number;
  recipient?: string | null;
  timezone?: string;
  updatedByUserId?: string | null;
}

export interface PilotReviewDeliveryPolicyExecutionResult {
  delivered: boolean;
  dryRun: boolean;
  error?: string;
  messageId?: string;
  policyId: string;
  reason: "delivered" | "failed" | "inactive" | "not_due" | "previewed";
  skipped: boolean;
}

export interface PilotReviewDeliveryPolicyExecutionSummary {
  checkedPolicies: number;
  deliveredPolicies: number;
  duePolicies: number;
  failedPolicies: number;
  previewPolicies: number;
  results: PilotReviewDeliveryPolicyExecutionResult[];
  skippedPolicies: number;
  timestamp: string;
}

export interface PilotReviewEmailDeliveryResult {
  bodyText: string;
  delivered: boolean;
  dryRun: boolean;
  headline: string;
  ledger?: BriefDeliveryLedgerRecord | null;
  messageId?: string;
  previewText: string;
  recipient: string | null;
  replayed?: boolean;
  scorecard: Pick<PilotReviewScorecard, "generatedAt" | "outcome" | "outcomeLabel"> & {
    tenantSlug: string;
  };
  subject: string;
}
