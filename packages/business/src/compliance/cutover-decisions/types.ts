import type { AccessProfile } from "@/lib/auth/access-profile";
import type { PilotReviewOutcome, PilotReviewScorecard } from "@/lib/pilot-review";
import type { TenantReadinessOutcome, TenantReadinessReport } from "@/lib/tenant-readiness";

export type CutoverDecisionType = "cutover_approved" | "rollback" | "warning_waiver";

export interface CutoverDecisionRecord {
  createdAt: string;
  createdByName: string | null;
  createdByRole: string | null;
  createdByUserId: string | null;
  decisionLabel: string;
  decisionType: CutoverDecisionType;
  details: string | null;
  id: string;
  readinessGeneratedAt: string;
  readinessOutcome: TenantReadinessOutcome;
  readinessOutcomeLabel: string;
  reviewGeneratedAt: string;
  reviewOutcome: PilotReviewOutcome;
  reviewOutcomeLabel: string;
  summary: string;
  tenantSlug: string;
  warningId: string | null;
  warningLabel: string | null;
  workspaceId: string;
}

export interface CutoverDecisionRegisterSummary {
  approvals: number;
  latestDecisionAt: string | null;
  latestRollbackAt: string | null;
  latestWaiverAt: string | null;
  rollbacks: number;
  total: number;
  waivers: number;
}

export interface CutoverDecisionRegister {
  entries: CutoverDecisionRecord[];
  latestDecision: CutoverDecisionRecord | null;
  summary: CutoverDecisionRegisterSummary;
}

export interface CreateCutoverDecisionInput {
  decisionType: CutoverDecisionType;
  details?: string | null;
  summary: string;
  warningId?: string | null;
  warningLabel?: string | null;
}

export interface CreateCutoverDecisionDeps {
  accessProfile?: AccessProfile;
  env?: NodeJS.ProcessEnv;
  getReadiness?: () => Promise<TenantReadinessReport>;
  getReview?: () => Promise<PilotReviewScorecard>;
  readiness?: TenantReadinessReport;
  review?: PilotReviewScorecard;
}
