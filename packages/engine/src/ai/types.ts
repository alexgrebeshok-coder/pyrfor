import type { Locale, MessageKey } from "@/lib/translations";
import type {
  NotificationItem,
  Priority,
  Project,
  Risk,
  Task,
  TeamMember,
} from "@/lib/types";

export type AIAdapterMode = "mock" | "gateway" | "provider";
export type AIWorkspaceMode = "auto" | AIAdapterMode | "local";

export type AIRunStatus =
  | "queued"
  | "running"
  | "needs_approval"
  | "done"
  | "failed";

export type AIProposalState = "pending" | "applied" | "dismissed";
export type AIApplyExecutionStatus = "executing" | "executed" | "failed";
export type AIActionType =
  | "create_tasks"
  | "update_tasks"
  | "reschedule_tasks"
  | "raise_risks"
  | "draft_status_report"
  | "notify_team";

export type AIAgentKind = "analyst" | "planner" | "reporter" | "researcher";
export type AIAgentCategory =
  | "auto"
  | "strategic"
  | "planning"
  | "monitoring"
  | "financial"
  | "knowledge"
  | "communication"
  | "special";

export type AIContextType = "portfolio" | "project" | "tasks";
export type AIApplySafetyLevel = "low" | "medium" | "high";
export type AIApplyExecutionMode =
  | "preview_only"
  | "guarded_patch"
  | "guarded_communication";
export type AICompensationMode =
  | "replace_draft"
  | "follow_up_patch"
  | "close_or_correct"
  | "send_correction_notice";

export type AIQuickActionKind =
  | "summarize_portfolio"
  | "analyze_project"
  | "suggest_tasks"
  | "draft_status_report"
  | "triage_tasks";

export interface AIContextRef {
  type: AIContextType;
  pathname: string;
  title: string;
  subtitle: string;
  projectId?: string;
}

export interface AIContextSnapshot {
  locale: Locale;
  interfaceLocale: Locale;
  generatedAt: string;
  activeContext: AIContextRef;
  projects: Project[];
  tasks: Task[];
  team: TeamMember[];
  risks: Risk[];
  notifications: NotificationItem[];
  project?: Project;
  projectTasks?: Task[];
}

export interface AIRunSourceRef {
  workflow: string;
  purpose?: string;
  packetId?: string;
  packetLabel?: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  projectId?: string;
  projectName?: string;
  replayOfRunId?: string;
  replayReason?: string;
}

export interface AIAgentDefinition {
  id: string;
  kind: AIAgentKind;
  nameKey: MessageKey;
  descriptionKey?: MessageKey;
  accentClass: string;
  icon: string;
  category: AIAgentCategory;
  recommended?: boolean;
}

export interface AIQuickActionDefinition {
  id: string;
  kind: AIQuickActionKind;
  agentId: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  promptKey: MessageKey;
  contextTypes: AIContextType[];
}

export interface AITaskDraft {
  projectId: string;
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  priority: Priority;
  reason: string;
}

export interface AITaskUpdateDraft {
  taskId: string;
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;
  priority?: Priority;
  reason: string;
}

export interface AITaskRescheduleDraft {
  taskId: string;
  title: string;
  previousDueDate: string;
  newDueDate: string;
  assignee?: string;
  reason: string;
}

export interface AIRiskDraft {
  projectId: string;
  title: string;
  description: string;
  owner: string;
  probability: number;
  impact: number;
  mitigation: string;
  reason: string;
}

export interface AIStatusReportDraft {
  projectId?: string;
  title: string;
  audience: string;
  channel: string;
  summary: string;
  body: string;
  reason: string;
}

export type AIConfidenceBand = "low" | "medium" | "high" | "strong";

export interface AIEvidenceFact {
  label: string;
  value: string;
  href?: string;
  meta?: string;
}

export interface AIConfidenceSummary {
  score: number;
  band: AIConfidenceBand;
  label: string;
  rationale: string;
  basis: string[];
}

export interface AINotificationDraft {
  channel: string;
  recipients: string[];
  message: string;
  reason: string;
}

interface AIActionProposalBase {
  id: string;
  type: AIActionType;
  title: string;
  summary: string;
  state: AIProposalState;
  tasks: AITaskDraft[];
  facts?: AIEvidenceFact[];
  confidence?: AIConfidenceSummary;
}

export interface AICreateTasksProposal extends AIActionProposalBase {
  type: "create_tasks";
  tasks: AITaskDraft[];
}

export interface AIUpdateTasksProposal extends AIActionProposalBase {
  type: "update_tasks";
  taskUpdates: AITaskUpdateDraft[];
}

export interface AIRescheduleTasksProposal extends AIActionProposalBase {
  type: "reschedule_tasks";
  taskReschedules: AITaskRescheduleDraft[];
}

export interface AIRaiseRisksProposal extends AIActionProposalBase {
  type: "raise_risks";
  risks: AIRiskDraft[];
}

export interface AIDraftStatusReportProposal extends AIActionProposalBase {
  type: "draft_status_report";
  statusReport: AIStatusReportDraft;
}

export interface AINotifyTeamProposal extends AIActionProposalBase {
  type: "notify_team";
  notifications: AINotificationDraft[];
}

export type AIActionProposal =
  | AICreateTasksProposal
  | AIUpdateTasksProposal
  | AIRescheduleTasksProposal
  | AIRaiseRisksProposal
  | AIDraftStatusReportProposal
  | AINotifyTeamProposal;

export interface AIApplyResult {
  proposalId: string;
  type: AIActionType;
  appliedAt: string;
  summary: string;
  itemCount: number;
  tasksCreated: AITaskDraft[];
  tasksUpdated: AITaskUpdateDraft[];
  tasksRescheduled: AITaskRescheduleDraft[];
  risksRaised: AIRiskDraft[];
  draftedStatusReport: AIStatusReportDraft | null;
  notificationsSent: AINotificationDraft[];
  safety: AIApplySafetySummary;
  execution?: AIApplyExecutionSummary | null;
}

export interface AIProposalSafetyProfile {
  level: AIApplySafetyLevel;
  executionMode: AIApplyExecutionMode;
  liveMutation: boolean;
  mutationSurface: string;
  checks: string[];
  compensationMode: AICompensationMode;
  compensationSummary: string;
  compensationSteps: string[];
}

export interface AIApplySafetySummary extends AIProposalSafetyProfile {
  operatorDecision: "manual_apply";
  postApplyState: "draft_only" | "guarded_execution";
}

export interface AIApplyExecutionStep {
  toolCallId: string;
  toolName: string;
  success: boolean;
  message: string;
  entityId?: string;
}

export interface AIApplyExecutionSummary {
  decisionId: string;
  status: AIApplyExecutionStatus;
  operatorId?: string | null;
  idempotencyKey: string;
  toolCallIds: string[];
  steps: AIApplyExecutionStep[];
}

export interface AIRunResult {
  title: string;
  summary: string;
  highlights: string[];
  nextSteps: string[];
  facts?: AIEvidenceFact[];
  confidence?: AIConfidenceSummary;
  proposal?: AIActionProposal | null;
  actionResult?: AIApplyResult | null;
  collaboration?: AIMultiAgentCollaboration | null;
}

export interface AIMultiAgentRuntime {
  provider: string;
  model: string;
}

export interface AIMultiAgentStep {
  agentId: string;
  agentName: string;
  role: string;
  focus: string;
  status: "done" | "failed";
  runtime: AIMultiAgentRuntime;
  title: string;
  summary: string;
  highlights: string[];
  nextSteps: string[];
  proposalType: AIActionType | null;
  error?: string;
}

export interface AIMultiAgentCollaboration {
  mode: "collaborative";
  leaderAgentId: string;
  leaderRuntime: AIMultiAgentRuntime;
  supportAgentIds: string[];
  reason: string;
  consensus: string[];
  steps: AIMultiAgentStep[];
}

export interface AIRunRecord {
  id: string;
  sessionId?: string;
  agentId: string;
  title: string;
  prompt: string;
  quickActionId?: string;
  status: AIRunStatus;
  createdAt: string;
  updatedAt: string;
  context: AIContextRef;
  result?: AIRunResult;
  errorMessage?: string;
}

export interface AIRunInput {
  agent: AIAgentDefinition;
  prompt: string;
  context: AIContextSnapshot;
  quickAction?: AIQuickActionDefinition;
  source?: AIRunSourceRef;
  sessionId?: string;
  signal?: AbortSignal;
  /**
   * Workspace ownership tag. Populated automatically by the AI kernel control
   * plane from the calling actor context so runs stay isolated between
   * workspaces; callers generally do not need to set this directly.
   */
  workspaceId?: string;
  /**
   * User ownership tag. Populated automatically by the AI kernel control
   * plane from the calling actor context for auditability.
   */
  ownerUserId?: string;
}

export interface AIApplyProposalInput {
  runId: string;
  proposalId: string;
  operatorId?: string;
}

export interface AIAdapter {
  mode: AIAdapterMode;
  runAgent: (input: AIRunInput & { signal?: AbortSignal }) => Promise<AIRunRecord>;
  getRun: (runId: string) => Promise<AIRunRecord>;
  applyProposal: (input: AIApplyProposalInput) => Promise<AIRunRecord>;
}
