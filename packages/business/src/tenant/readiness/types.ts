import type { AccessProfile } from "@/lib/auth/access-profile";
import type {
  ExceptionInboxResult,
  ExceptionInboxUrgency,
} from "@/lib/command-center";
import type { ConnectorStatus, ConnectorStatusSummary } from "@/lib/connectors";
import type {
  PilotFeedbackListResult,
  PilotFeedbackSeverity,
} from "@/lib/pilot-feedback";
import type {
  PilotControlState,
  PilotControlledWorkflow,
} from "@/lib/server/pilot-controls";
import type { ServerRuntimeState } from "@/lib/server/runtime-mode";

export type TenantReadinessOutcome =
  | "blocked"
  | "guarded"
  | "ready"
  | "ready_with_warnings";
export type TenantReadinessState = "blocked" | "ready" | "warning";
export type TenantReadinessFindingCategory =
  | "command_center"
  | "connector"
  | "pilot_feedback"
  | "rollout"
  | "runtime";

export interface TenantReadinessLinkView {
  href: string;
  label: string;
}

export interface TenantReadinessFinding {
  action: string;
  category: TenantReadinessFindingCategory;
  id: string;
  links: TenantReadinessLinkView[];
  state: TenantReadinessState;
  summary: string;
  title: string;
}

export interface TenantReadinessChecklistItem {
  id: string;
  label: string;
  links: TenantReadinessLinkView[];
  state: TenantReadinessState;
  summary: string;
  value: string;
}

export interface TenantReadinessTenantView {
  label: string;
  slug: string;
  source: "access_profile" | "default" | "pilot_control";
}

export interface TenantReadinessSummary {
  blockers: number;
  connectorsConfigured: number;
  connectorsDegraded: number;
  connectorsOk: number;
  connectorsPending: number;
  readySignals: number;
  unresolvedExceptions: number;
  unresolvedFeedback: number;
  warnings: number;
}

export interface TenantReadinessPosture {
  blockedWorkflows: Array<{
    id: PilotControlledWorkflow;
    label: string;
  }>;
  configured: boolean;
  liveMutationAllowed: boolean;
  runtimeStatus: PilotControlState["runtimeStatus"];
  stage: PilotControlState["stage"];
  stageLabel: string;
  tenantSlug: string | null;
  writeWorkspaces: string[];
}

export interface TenantReadinessReport {
  accessProfile: Pick<AccessProfile, "organizationSlug" | "role" | "workspaceId">;
  blockers: TenantReadinessFinding[];
  checklist: TenantReadinessChecklistItem[];
  connectorSummary: ConnectorStatusSummary;
  connectors: ConnectorStatus[];
  generatedAt: string;
  outcome: TenantReadinessOutcome;
  outcomeLabel: string;
  pilotFeedback: Pick<PilotFeedbackListResult["summary"], "critical" | "high" | "inReview" | "open" | "resolved" | "total">;
  posture: TenantReadinessPosture;
  readySignals: TenantReadinessFinding[];
  runtime: ServerRuntimeState;
  summary: TenantReadinessSummary;
  tenant: TenantReadinessTenantView;
  unresolvedConcerns: Pick<ExceptionInboxResult["summary"], "acknowledged" | "critical" | "high" | "open" | "resolved" | "total">;
  warnings: TenantReadinessFinding[];
}

export interface TenantReadinessBuildInput {
  accessProfile: AccessProfile;
  connectors: ConnectorStatus[];
  feedback: PilotFeedbackListResult | null;
  generatedAt: string;
  inbox: ExceptionInboxResult | null;
  pilot: PilotControlState;
  runtime: ServerRuntimeState;
}

export function isCriticalConcern(urgency: ExceptionInboxUrgency) {
  return urgency === "critical" || urgency === "high";
}

export function isCriticalFeedback(severity: PilotFeedbackSeverity) {
  return severity === "critical" || severity === "high";
}
