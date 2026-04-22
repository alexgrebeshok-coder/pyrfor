import type {
  ExecutiveMilestone,
  ExecutiveProject,
  ExecutiveSnapshot,
  ExecutiveWorkReport,
} from "@/lib/briefs/types";

import type {
  PlanFactEvmMetrics,
  PlanFactProjectStatus,
  PlanFactWarning,
  PortfolioPlanFactSignal,
  PortfolioPlanFactSummary,
  ProjectPlanFactSummary,
} from "./types";

interface PlanFactOptions {
  referenceDate?: string | Date;
}

export function buildProjectPlanFactSummary(
  snapshot: ExecutiveSnapshot,
  projectId: string,
  options: PlanFactOptions = {}
): ProjectPlanFactSummary {
  const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    throw new Error(`Project "${projectId}" was not found.`);
  }

  const tasks = snapshot.tasks.filter((task) => task.projectId === project.id);
  const milestones = snapshot.milestones.filter((milestone) => milestone.projectId === project.id);
  const workReports = snapshot.workReports.filter((report) => report.projectId === project.id);

  const completedTasks = tasks.filter((task) => task.status === "done").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const overdueTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() < referenceDate.getTime()
  ).length;
  const completedMilestones = milestones.filter(
    (milestone) => milestone.status === "completed"
  ).length;
  const overdueMilestones = milestones.filter(
    (milestone) =>
      milestone.status !== "completed" &&
      new Date(milestone.date).getTime() < referenceDate.getTime()
  ).length;
  const approvedWorkReports = workReports.filter((report) => report.status === "approved");
  const pendingWorkReports = workReports.filter((report) => report.status === "submitted");
  const rejectedWorkReports = workReports.filter((report) => report.status === "rejected");

  const taskProgress = tasks.length > 0 ? round((completedTasks / tasks.length) * 100, 1) : null;
  const milestoneProgress =
    milestones.length > 0
      ? round((completedMilestones / milestones.length) * 100, 1)
      : null;
  const plannedProgress = calculatePlannedProgress(project, referenceDate);
  const actualProgress = calculateActualProgress(project, taskProgress, milestoneProgress);
  const progressVariance = round(actualProgress - plannedProgress, 1);
  const progressVarianceRatio =
    plannedProgress > 0 ? round(progressVariance / plannedProgress, 3) : 0;
  const budgetPlanToDate = calculateBudgetPlanToDate(project, referenceDate);
  const budgetVariance = round(project.budget.actual - budgetPlanToDate, 2);
  const budgetVarianceRatio =
    budgetPlanToDate > 0 ? round(budgetVariance / budgetPlanToDate, 3) : 0;
  const evm = calculateEvmMetrics(project, plannedProgress, actualProgress);
  const lastApprovedWorkReportDate = latestApprovedReportDate(approvedWorkReports);
  const daysSinceLastApprovedReport = lastApprovedWorkReportDate
    ? diffInDays(new Date(lastApprovedWorkReportDate), referenceDate)
    : null;
  const confidence = calculateConfidence({
    milestoneCount: milestones.length,
    lastApprovedWorkReportDate,
    taskCount: tasks.length,
    totalWorkReports: workReports.length,
  }, referenceDate);

  const warnings = buildWarnings({
    blockedTasks,
    budgetVariance,
    budgetVarianceRatio,
    daysSinceLastApprovedReport,
    evm,
    milestoneProgress,
    milestones,
    overdueMilestones,
    overdueTasks,
    pendingWorkReports: pendingWorkReports.length,
    plannedProgress,
    progressVariance,
    project,
    referenceDate,
    taskProgress,
    confidence,
  });

  return {
    projectId: project.id,
    projectName: project.name,
    referenceDate: referenceDate.toISOString(),
    status: deriveProjectStatus(warnings),
    confidence,
    currency: project.budget.currency,
    plannedProgress,
    actualProgress,
    reportedProgress: project.progress,
    taskProgress,
    milestoneProgress,
    progressVariance,
    progressVarianceRatio,
    daysToDeadline: diffInDays(referenceDate, new Date(project.dates.end)),
    forecastFinishDate: forecastFinishDate(project, actualProgress, evm.spi, referenceDate),
    budgetVariance,
    budgetVarianceRatio,
    evidence: {
      totalTasks: tasks.length,
      completedTasks,
      blockedTasks,
      overdueTasks,
      totalMilestones: milestones.length,
      completedMilestones,
      overdueMilestones,
      totalWorkReports: workReports.length,
      approvedWorkReports: approvedWorkReports.length,
      pendingWorkReports: pendingWorkReports.length,
      rejectedWorkReports: rejectedWorkReports.length,
      lastApprovedWorkReportDate,
      daysSinceLastApprovedReport,
    },
    evm,
    warnings,
  };
}

export function buildPortfolioPlanFactSummary(
  snapshot: ExecutiveSnapshot,
  options: PlanFactOptions = {}
): PortfolioPlanFactSummary {
  const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
  const projects = snapshot.projects.map((project) =>
    buildProjectPlanFactSummary(snapshot, project.id, { referenceDate })
  );

  const bac = round(sum(projects.map((project) => project.evm.bac)), 2);
  const pv = round(sum(projects.map((project) => project.evm.pv)), 2);
  const ev = round(sum(projects.map((project) => project.evm.ev)), 2);
  const ac = round(sum(projects.map((project) => project.evm.ac)), 2);
  const cpi = ac > 0 ? round(ev / ac, 3) : null;
  const spi = pv > 0 ? round(ev / pv, 3) : null;
  const eac = cpi && cpi > 0 ? round(bac / cpi, 2) : null;
  const vac = eac !== null ? round(bac - eac, 2) : null;
  const plannedProgress = projects.length
    ? round(sum(projects.map((project) => project.plannedProgress)) / projects.length, 1)
    : 0;
  const actualProgress = projects.length
    ? round(sum(projects.map((project) => project.actualProgress)) / projects.length, 1)
    : 0;
  const progressVariance = round(actualProgress - plannedProgress, 1);
  const budgetVariance = round(sum(projects.map((project) => project.budgetVariance)), 2);
  const budgetVarianceRatio = pv > 0 ? round(budgetVariance / pv, 3) : 0;

  const topSignals = projects
    .flatMap<PortfolioPlanFactSignal>((project) =>
      project.warnings.map((warning) => ({
        ...warning,
        projectId: project.projectId,
        projectName: project.projectName,
      }))
    )
    .sort(compareSignals)
    .slice(0, 8);

  return {
    referenceDate: referenceDate.toISOString(),
    status: deriveProjectStatus(topSignals),
    totals: {
      projectCount: projects.length,
      bac,
      pv,
      ev,
      ac,
      cpi,
      spi,
      eac,
      vac,
      plannedProgress,
      actualProgress,
      progressVariance,
      budgetVariance,
      budgetVarianceRatio,
      projectsBehindPlan: projects.filter((project) => project.progressVariance <= -10).length,
      projectsOverBudget: projects.filter((project) => project.budgetVarianceRatio >= 0.1).length,
      staleFieldReportingProjects: projects.filter(
        (project) =>
          project.evidence.daysSinceLastApprovedReport !== null &&
          project.evidence.daysSinceLastApprovedReport >= 3
      ).length,
      pendingReviewProjects: projects.filter(
        (project) => project.evidence.pendingWorkReports >= 2
      ).length,
      criticalProjects: projects.filter((project) => project.status === "critical").length,
    },
    projects,
    topSignals,
  };
}

export function summarizeProjectPlanFactForBrief(
  summary: ProjectPlanFactSummary
) {
  return {
    plannedProgress: summary.plannedProgress,
    actualProgress: summary.actualProgress,
    progressVariance: summary.progressVariance,
    cpi: summary.evm.cpi,
    spi: summary.evm.spi,
    pendingWorkReports: summary.evidence.pendingWorkReports,
    daysSinceLastApprovedReport: summary.evidence.daysSinceLastApprovedReport,
  };
}

function calculatePlannedProgress(project: ExecutiveProject, referenceDate: Date) {
  const start = new Date(project.dates.start).getTime();
  const end = new Date(project.dates.end).getTime();
  const reference = referenceDate.getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return round(project.progress, 1);
  }

  return round(clamp(((reference - start) / (end - start)) * 100, 0, 100), 1);
}

function calculateBudgetPlanToDate(project: ExecutiveProject, referenceDate: Date) {
  const datedHistory = [...project.history]
    .filter((point) => new Date(point.date).getTime() <= referenceDate.getTime())
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

  if (datedHistory.length > 0) {
    return round(datedHistory[datedHistory.length - 1]?.budgetPlanned ?? 0, 2);
  }

  return round(project.budget.planned * (calculatePlannedProgress(project, referenceDate) / 100), 2);
}

function calculateActualProgress(
  project: ExecutiveProject,
  taskProgress: number | null,
  milestoneProgress: number | null
) {
  const weightedSignals: Array<{ value: number; weight: number }> = [
    { value: project.progress, weight: 0.5 },
  ];

  if (taskProgress !== null) {
    weightedSignals.push({ value: taskProgress, weight: 0.35 });
  }

  if (milestoneProgress !== null) {
    weightedSignals.push({ value: milestoneProgress, weight: 0.15 });
  }

  const totalWeight = sum(weightedSignals.map((signal) => signal.weight));
  if (totalWeight <= 0) {
    return round(project.progress, 1);
  }

  return round(
    weightedSignals.reduce((accumulator, signal) => accumulator + signal.value * signal.weight, 0) /
      totalWeight,
    1
  );
}

function calculateEvmMetrics(
  project: ExecutiveProject,
  plannedProgress: number,
  actualProgress: number
): PlanFactEvmMetrics {
  const bac = round(project.budget.planned, 2);
  const pv = round(bac * (plannedProgress / 100), 2);
  const ev = round(bac * (actualProgress / 100), 2);
  const ac = round(project.budget.actual, 2);
  const cv = round(ev - ac, 2);
  const sv = round(ev - pv, 2);
  const cpi = ac > 0 ? round(ev / ac, 3) : null;
  const spi = pv > 0 ? round(ev / pv, 3) : null;
  const eac = cpi && cpi > 0 ? round(bac / cpi, 2) : null;
  const vac = eac !== null ? round(bac - eac, 2) : null;

  return {
    bac,
    pv,
    ev,
    ac,
    cv,
    sv,
    cpi,
    spi,
    eac,
    vac,
    percentComplete: round(actualProgress, 1),
  };
}

function latestApprovedReportDate(workReports: ExecutiveWorkReport[]) {
  const dates = workReports
    .map((report) => new Date(report.reportDate).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left);

  return dates.length ? new Date(dates[0]).toISOString() : null;
}

function calculateConfidence(
  input: {
    milestoneCount: number;
    lastApprovedWorkReportDate: string | null;
    taskCount: number;
    totalWorkReports: number;
  },
  referenceDate: Date
) {
  let confidence = 0.35;

  if (input.taskCount > 0) confidence += 0.25;
  if (input.milestoneCount > 0) confidence += 0.15;
  if (input.totalWorkReports > 0) confidence += 0.15;

  if (input.lastApprovedWorkReportDate) {
    const days = diffInDays(new Date(input.lastApprovedWorkReportDate), referenceDate);
    confidence += days <= 2 ? 0.1 : days <= 5 ? 0.05 : 0;
  }

  return round(clamp(confidence, 0.3, 0.95), 2);
}

function buildWarnings(input: {
  blockedTasks: number;
  budgetVariance: number;
  budgetVarianceRatio: number;
  confidence: number;
  daysSinceLastApprovedReport: number | null;
  evm: PlanFactEvmMetrics;
  milestoneProgress: number | null;
  milestones: ExecutiveMilestone[];
  overdueMilestones: number;
  overdueTasks: number;
  pendingWorkReports: number;
  plannedProgress: number;
  progressVariance: number;
  project: ExecutiveProject;
  referenceDate: Date;
  taskProgress: number | null;
}): PlanFactWarning[] {
  const warnings: PlanFactWarning[] = [];
  const nextMilestone = input.milestones
    .filter((milestone) => milestone.status !== "completed")
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0];
  const daysToMilestone = nextMilestone
    ? diffInDays(input.referenceDate, new Date(nextMilestone.date))
    : null;

  if (
    input.progressVariance <= -10 ||
    input.overdueTasks > 0 ||
    (input.evm.spi !== null && input.evm.spi < 0.9)
  ) {
    warnings.push({
      code: "SCHEDULE_DRIFT",
      severity:
        diffInDays(input.referenceDate, new Date(input.project.dates.end)) < 0 ||
        input.overdueTasks >= 3 ||
        (input.evm.spi !== null && input.evm.spi < 0.75)
          ? "critical"
          : input.progressVariance <= -15
            ? "high"
            : "medium",
      title: "Execution is trailing the planned curve",
      summary: `${input.project.name} is ${Math.abs(input.progressVariance)}pp behind plan with ${input.overdueTasks} overdue tasks and SPI ${formatNullableMetric(input.evm.spi)}.`,
      metrics: {
        progressVariance: input.progressVariance,
        overdueTasks: input.overdueTasks,
        spi: input.evm.spi,
      },
    });
  }

  if (
    input.evm.ac > 0 &&
    (input.budgetVarianceRatio >= 0.1 ||
      input.evm.ac > input.evm.bac ||
      (input.evm.cpi !== null && input.evm.cpi < 0.9))
  ) {
    const overspending =
      input.budgetVarianceRatio >= 0.1 || input.evm.ac > input.evm.bac;
    const lowEfficiency = input.evm.cpi !== null && input.evm.cpi < 0.9;
    warnings.push({
      code: "COST_PRESSURE",
      severity:
        input.budgetVarianceRatio >= 0.2 ||
        input.evm.ac > input.evm.bac ||
        (input.evm.cpi !== null && input.evm.cpi < 0.75)
          ? "critical"
          : "high",
      title: overspending
        ? "Cost burn is ahead of plan"
        : "Cost efficiency is below target",
      summary: overspending
        ? `${input.project.name} is running ${formatSignedPercent(input.budgetVarianceRatio)} versus planned-to-date with CPI ${formatNullableMetric(input.evm.cpi)}.`
        : `${input.project.name} is still under the planned spend curve, but CPI ${formatNullableMetric(input.evm.cpi)} shows weak earned-value efficiency against delivered progress.`,
      metrics: {
        budgetVariance: input.budgetVariance,
        budgetVarianceRatio: input.budgetVarianceRatio,
        cpi: input.evm.cpi,
        overspending: overspending ? 1 : 0,
        lowEfficiency: lowEfficiency ? 1 : 0,
      },
    });
  }

  if (
    input.overdueMilestones > 0 ||
    (daysToMilestone !== null &&
      daysToMilestone <= 14 &&
      (input.taskProgress ?? input.milestoneProgress ?? input.project.progress) + 8 <
        input.plannedProgress)
  ) {
    warnings.push({
      code: "MILESTONE_RISK",
      severity:
        input.overdueMilestones > 0 || (daysToMilestone !== null && daysToMilestone <= 7)
          ? "high"
          : "medium",
      title: "Near-term milestone is exposed",
      summary: nextMilestone
        ? `Milestone "${nextMilestone.title}" is due in ${daysToMilestone} days while execution remains behind plan.`
        : `Project milestones are slipping against the current baseline.`,
      metrics: {
        overdueMilestones: input.overdueMilestones,
        daysToMilestone,
      },
    });
  }

  if (
    input.project.status === "active" &&
    input.daysSinceLastApprovedReport !== null &&
    input.daysSinceLastApprovedReport >= 3
  ) {
    warnings.push({
      code: "STALE_FIELD_REPORTING",
      severity: input.daysSinceLastApprovedReport >= 5 ? "high" : "medium",
      title: "Field reporting is stale",
      summary: `${input.project.name} has no approved field report for ${input.daysSinceLastApprovedReport} days.`,
      metrics: {
        daysSinceLastApprovedReport: input.daysSinceLastApprovedReport,
      },
    });
  }

  if (input.pendingWorkReports >= 2) {
    warnings.push({
      code: "REVIEW_BACKLOG",
      severity: input.pendingWorkReports >= 4 ? "high" : "medium",
      title: "Work report review backlog is building up",
      summary: `${input.pendingWorkReports} work reports are still pending review for ${input.project.name}.`,
      metrics: {
        pendingWorkReports: input.pendingWorkReports,
      },
    });
  }

  if (input.confidence < 0.55) {
    warnings.push({
      code: "LOW_DELIVERY_CONFIDENCE",
      severity: "low",
      title: "Delivery evidence is thin",
      summary: `${input.project.name} has limited task, milestone, or field evidence; current plan-vs-fact confidence is ${input.confidence}.`,
      metrics: {
        confidence: input.confidence,
      },
    });
  }

  if (input.blockedTasks >= 2 && !warnings.some((warning) => warning.code === "SCHEDULE_DRIFT")) {
    warnings.push({
      code: "SCHEDULE_DRIFT",
      severity: "medium",
      title: "Blocked tasks are slowing execution",
      summary: `${input.blockedTasks} blocked tasks are constraining the near-term schedule in ${input.project.name}.`,
      metrics: {
        blockedTasks: input.blockedTasks,
      },
    });
  }

  return warnings.sort(compareSignals);
}

function deriveProjectStatus(
  warnings: Array<{ severity: "critical" | "high" | "medium" | "low" }>
): PlanFactProjectStatus {
  if (warnings.some((warning) => warning.severity === "critical")) {
    return "critical";
  }

  if (warnings.length > 0) {
    return "watch";
  }

  return "on_track";
}

function forecastFinishDate(
  project: ExecutiveProject,
  actualProgress: number,
  spi: number | null,
  referenceDate: Date
) {
  if (actualProgress >= 100) {
    return referenceDate.toISOString();
  }

  const start = new Date(project.dates.start).getTime();
  const end = new Date(project.dates.end).getTime();
  const reference = referenceDate.getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  const totalDuration = end - start;
  const plannedEnd = Math.max(reference, end);
  const baseRemaining =
    plannedEnd > reference ? plannedEnd - reference : totalDuration * (1 - actualProgress / 100);
  const pace = spi && spi > 0 ? clamp(spi, 0.35, 2) : 1;
  const adjustedRemaining = baseRemaining / pace;

  return new Date(reference + adjustedRemaining).toISOString();
}

function compareSignals(
  left: { severity: string },
  right: { severity: string }
) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return (
    order[left.severity as keyof typeof order] - order[right.severity as keyof typeof order]
  );
}

function diffInDays(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function sum(values: number[]) {
  return values.reduce((accumulator, value) => accumulator + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function formatNullableMetric(value: number | null) {
  return value === null ? "n/a" : value.toFixed(2);
}

function formatSignedPercent(value: number) {
  const percent = Math.abs(value * 100).toFixed(1);
  return value > 0 ? `+${percent}%` : value < 0 ? `-${percent}%` : "0.0%";
}
