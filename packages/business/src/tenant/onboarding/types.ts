import type { AccessProfile } from "@/lib/auth/access-profile";
import type { CutoverDecisionRecord } from "@/lib/cutover-decisions";
import type { PilotReviewScorecard } from "@/lib/pilot-review";
import type { TenantReadinessLinkView, TenantReadinessReport, TenantReadinessState } from "@/lib/tenant-readiness";

export type TenantOnboardingRunbookStatus = "completed" | "draft" | "prepared" | "scheduled";

export interface TenantOnboardingTemplateItem {
  id: string;
  label: string;
  links: TenantReadinessLinkView[];
  state: TenantReadinessState;
  summary: string;
  value: string;
}

export interface TenantOnboardingRunbookRecord {
  baselineTenantLabel: string;
  baselineTenantSlug: string;
  blockerCount: number;
  createdAt: string;
  createdByName: string | null;
  createdByRole: string | null;
  createdByUserId: string | null;
  handoffNotes: string | null;
  id: string;
  latestDecisionAt: string | null;
  latestDecisionLabel: string | null;
  latestDecisionSummary: string | null;
  latestDecisionType: CutoverDecisionRecord["decisionType"] | null;
  operatorNotes: string | null;
  readinessGeneratedAt: string;
  readinessOutcome: TenantReadinessReport["outcome"];
  readinessOutcomeLabel: string;
  reviewGeneratedAt: string;
  reviewOutcome: PilotReviewScorecard["outcome"];
  reviewOutcomeLabel: string;
  rollbackPlan: string | null;
  rolloutScope: string;
  status: TenantOnboardingRunbookStatus;
  statusLabel: string;
  summary: string;
  targetCutoverAt: string | null;
  targetTenantLabel: string | null;
  targetTenantSlug: string | null;
  templateVersion: string;
  updatedAt: string;
  updatedByUserId: string | null;
  warningCount: number;
  workspaceId: string;
}

export interface TenantOnboardingRunbookListResult {
  entries: TenantOnboardingRunbookRecord[];
  latestRunbook: TenantOnboardingRunbookRecord | null;
  summary: {
    completed: number;
    draft: number;
    prepared: number;
    scheduled: number;
    total: number;
  };
}

export interface TenantOnboardingCurrentReadinessView {
  generatedAt: string;
  outcome: TenantReadinessReport["outcome"];
  outcomeLabel: string;
  posture: Pick<
    TenantReadinessReport["posture"],
    "liveMutationAllowed" | "stage" | "stageLabel" | "tenantSlug" | "writeWorkspaces"
  >;
  summary: Pick<TenantReadinessReport["summary"], "blockers" | "warnings">;
  tenant: TenantReadinessReport["tenant"];
}

export interface TenantOnboardingCurrentReviewView {
  artifact: Pick<PilotReviewScorecard["artifact"], "fileName" | "format">;
  generatedAt: string;
  outcome: PilotReviewScorecard["outcome"];
  outcomeLabel: string;
  summary: Pick<
    PilotReviewScorecard["summary"],
    "blockedSections" | "openExceptions" | "openFeedback" | "warningSections"
  >;
}

export interface TenantOnboardingOverview {
  accessProfile: Pick<AccessProfile, "organizationSlug" | "role" | "workspaceId">;
  currentReadiness: TenantOnboardingCurrentReadinessView;
  currentReview: TenantOnboardingCurrentReviewView;
  generatedAt: string;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
  persistenceAvailable: boolean;
  runbooks: TenantOnboardingRunbookRecord[];
  summary: TenantOnboardingRunbookListResult["summary"];
  template: {
    intro: string;
    items: TenantOnboardingTemplateItem[];
    version: string;
  };
}

export interface CreateTenantOnboardingRunbookInput {
  handoffNotes?: string | null;
  operatorNotes?: string | null;
  rollbackPlan?: string | null;
  rolloutScope: string;
  status?: TenantOnboardingRunbookStatus;
  summary: string;
  targetCutoverAt?: string | null;
  targetTenantLabel?: string | null;
  targetTenantSlug?: string | null;
}

export interface UpdateTenantOnboardingRunbookInput {
  handoffNotes?: string | null;
  operatorNotes?: string | null;
  rollbackPlan?: string | null;
  rolloutScope?: string;
  status?: TenantOnboardingRunbookStatus;
  summary?: string;
  targetCutoverAt?: string | null;
  targetTenantLabel?: string | null;
  targetTenantSlug?: string | null;
}
