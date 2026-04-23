export type PlanFactWarningCode =
  | "SCHEDULE_DRIFT"
  | "COST_PRESSURE"
  | "MILESTONE_RISK"
  | "STALE_FIELD_REPORTING"
  | "REVIEW_BACKLOG"
  | "LOW_DELIVERY_CONFIDENCE";

export type PlanFactWarningSeverity = "critical" | "high" | "medium" | "low";
export type PlanFactProjectStatus = "on_track" | "watch" | "critical";

export interface PlanFactWarning {
  code: PlanFactWarningCode;
  severity: PlanFactWarningSeverity;
  title: string;
  summary: string;
  metrics?: Record<string, number | string | null>;
}

export interface PlanFactEvidenceSummary {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overdueMilestones: number;
  totalWorkReports: number;
  approvedWorkReports: number;
  pendingWorkReports: number;
  rejectedWorkReports: number;
  lastApprovedWorkReportDate: string | null;
  daysSinceLastApprovedReport: number | null;
}

export interface PlanFactEvmMetrics {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number;
  sv: number;
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  vac: number | null;
  percentComplete: number;
}

export interface ProjectPlanFactSummary {
  projectId: string;
  projectName: string;
  referenceDate: string;
  status: PlanFactProjectStatus;
  confidence: number;
  currency: string;
  plannedProgress: number;
  actualProgress: number;
  reportedProgress: number;
  taskProgress: number | null;
  milestoneProgress: number | null;
  progressVariance: number;
  progressVarianceRatio: number;
  daysToDeadline: number;
  forecastFinishDate: string | null;
  budgetVariance: number;
  budgetVarianceRatio: number;
  evidence: PlanFactEvidenceSummary;
  evm: PlanFactEvmMetrics;
  warnings: PlanFactWarning[];
}

export interface PortfolioPlanFactSignal extends PlanFactWarning {
  projectId: string;
  projectName: string;
}

export interface PortfolioPlanFactSummary {
  referenceDate: string;
  status: PlanFactProjectStatus;
  totals: {
    projectCount: number;
    bac: number;
    pv: number;
    ev: number;
    ac: number;
    cpi: number | null;
    spi: number | null;
    eac: number | null;
    vac: number | null;
    plannedProgress: number;
    actualProgress: number;
    progressVariance: number;
    budgetVariance: number;
    budgetVarianceRatio: number;
    projectsBehindPlan: number;
    projectsOverBudget: number;
    staleFieldReportingProjects: number;
    pendingReviewProjects: number;
    criticalProjects: number;
  };
  projects: ProjectPlanFactSummary[];
  topSignals: PortfolioPlanFactSignal[];
}
