import type { AccessProfile } from "@/lib/auth/access-profile";
import type { CutoverDecisionRecord } from "@/lib/cutover-decisions";
import type {
  TenantOnboardingCurrentReadinessView,
  TenantOnboardingCurrentReviewView,
  TenantOnboardingRunbookRecord,
} from "@/lib/tenant-onboarding";
import type { TenantReadinessLinkView, TenantReadinessState } from "@/lib/tenant-readiness";

export interface TenantRolloutPacketArtifact {
  content: string;
  fileName: string;
  format: "markdown";
  mediaType: "text/markdown";
}

export interface TenantRolloutPacketSection {
  id: "decision" | "handoff" | "readiness" | "review" | "runbook";
  label: string;
  lines: string[];
  links: TenantReadinessLinkView[];
  state: TenantReadinessState;
  summary: string;
}

export interface TenantRolloutPacketHandoff {
  generatedAt: string;
  isRunbookBacked: boolean;
  state: TenantReadinessState;
  stateLabel: string;
  summary: string;
  targetCutoverAt: string | null;
  targetTenantLabel: string | null;
  targetTenantSlug: string | null;
}

export interface TenantRolloutPacket {
  accessProfile: Pick<AccessProfile, "organizationSlug" | "role" | "workspaceId">;
  artifact: TenantRolloutPacketArtifact;
  currentReadiness: TenantOnboardingCurrentReadinessView;
  currentReview: TenantOnboardingCurrentReviewView;
  generatedAt: string;
  handoff: TenantRolloutPacketHandoff;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
  persistenceAvailable: boolean;
  sections: TenantRolloutPacketSection[];
  sourceLinks: TenantReadinessLinkView[];
  templateVersion: string;
}
