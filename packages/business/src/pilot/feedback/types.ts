export type PilotFeedbackTargetType =
  | "exception_item"
  | "reconciliation_casefile"
  | "workflow_run";
export type PilotFeedbackStatus = "in_review" | "open" | "resolved";
export type PilotFeedbackSeverity = "critical" | "high" | "low" | "medium";

export interface PilotFeedbackOwnerView {
  id: string | null;
  mode: "assigned" | "unassigned";
  name: string;
  role: string | null;
}

export interface PilotFeedbackLinkView {
  href: string;
  label: string;
}

export interface PilotFeedbackItemView {
  id: string;
  targetType: PilotFeedbackTargetType;
  targetId: string;
  targetLabel: string;
  sourceLabel: string;
  sourceHref: string | null;
  projectId: string | null;
  projectName: string | null;
  severity: PilotFeedbackSeverity;
  status: PilotFeedbackStatus;
  summary: string;
  details: string | null;
  reporterName: string | null;
  resolutionNote: string | null;
  owner: PilotFeedbackOwnerView;
  metadata: Record<string, unknown>;
  openedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: PilotFeedbackLinkView[];
}

export interface PilotFeedbackSummary {
  total: number;
  open: number;
  inReview: number;
  resolved: number;
  critical: number;
  high: number;
  assigned: number;
  unassigned: number;
  workflowRuns: number;
  exceptionItems: number;
  reconciliationTargets: number;
}

export interface PilotFeedbackListResult {
  items: PilotFeedbackItemView[];
  summary: PilotFeedbackSummary;
}

export interface PilotFeedbackQuery {
  includeResolved?: boolean;
  limit?: number;
  projectId?: string;
  status?: PilotFeedbackStatus;
  targetId?: string;
  targetType?: PilotFeedbackTargetType;
}

export interface CreatePilotFeedbackInput {
  targetType: PilotFeedbackTargetType;
  targetId: string;
  targetLabel: string;
  sourceLabel?: string | null;
  sourceHref?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  severity?: PilotFeedbackSeverity;
  summary: string;
  details?: string | null;
  ownerId?: string | null;
  reporterName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdatePilotFeedbackInput {
  status?: PilotFeedbackStatus;
  severity?: PilotFeedbackSeverity;
  summary?: string;
  details?: string | null;
  ownerId?: string | null;
  resolutionNote?: string | null;
}

export function buildPilotFeedbackPrefillHref(input: {
  targetType: PilotFeedbackTargetType;
  targetId: string;
  targetLabel: string;
  sourceLabel?: string | null;
  sourceHref?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}) {
  const params = new URLSearchParams({
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
  });

  if (input.sourceLabel) {
    params.set("sourceLabel", input.sourceLabel);
  }

  if (input.sourceHref) {
    params.set("sourceHref", input.sourceHref);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.projectName) {
    params.set("projectName", input.projectName);
  }

  return `/pilot-feedback?${params.toString()}`;
}
