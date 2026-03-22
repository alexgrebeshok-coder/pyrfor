import { buildAlertFeed, buildProjectAlerts } from "@/lib/alerts/scoring";
import {
  buildPortfolioPlanFactSummary,
  buildProjectPlanFactSummary,
  summarizeProjectPlanFactForBrief,
} from "@/lib/plan-fact/service";

import {
  type BriefLocale,
  formatList,
  formatProjectNoun,
  formatProjectStatus,
  formatRiskNoun,
  formatShortDate,
  formatSignedPercent,
  formatTaskNoun,
  resolveBriefLocale,
} from "./locale";
import { buildMockExecutiveSnapshot, loadExecutiveSnapshot } from "./snapshot";
import type {
  BriefFormats,
  BriefSections,
  ExecutiveProject,
  ExecutiveSnapshot,
  PortfolioBrief,
  ProjectBrief,
} from "./types";

type BriefOptions = {
  referenceDate?: string | Date;
  locale?: BriefLocale;
};

export async function generatePortfolioBrief(
  options: BriefOptions = {}
): Promise<PortfolioBrief> {
  const snapshot = await loadExecutiveSnapshot({
    generatedAt: options.referenceDate,
  });

  return generatePortfolioBriefFromSnapshot(snapshot, options);
}

export async function generateProjectBrief(
  projectId: string,
  options: BriefOptions = {}
): Promise<ProjectBrief> {
  const snapshot = await loadExecutiveSnapshot({
    generatedAt: options.referenceDate,
  });

  return generateProjectBriefFromSnapshot(snapshot, projectId, options);
}

export function generatePortfolioBriefFromSnapshot(
  snapshot: ExecutiveSnapshot,
  options: BriefOptions = {}
): PortfolioBrief {
  const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
  const locale = resolveBriefLocale(options.locale);
  const alertFeed = buildAlertFeed(snapshot, {
    locale,
    referenceDate,
    limit: 6,
  });
  const portfolioPlanFact = buildPortfolioPlanFactSummary(snapshot, {
    referenceDate,
  });
  const totalProjects = snapshot.projects.length;
  const activeProjects = snapshot.projects.filter((project) =>
    ["active", "planning", "at-risk", "on-hold"].includes(project.status)
  ).length;
  const completedProjects = snapshot.projects.filter(
    (project) => project.status === "completed" || project.progress >= 100
  ).length;
  const atRiskProjects = snapshot.projects.filter(
    (project) => project.status === "at-risk" || project.health < 55
  );
  const criticalProjects = new Set(
    alertFeed.alerts
      .filter((alert) => alert.projectId && alert.severity === "critical")
      .map((alert) => alert.projectId!)
  );
  const overdueTasks = snapshot.tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() < referenceDate.getTime()
  ).length;
  const averageHealth = average(snapshot.projects.map((project) => project.health));
  const budgetVariance = portfolioPlanFact.totals.budgetVariance;
  const budgetVarianceRatio = portfolioPlanFact.totals.budgetVarianceRatio;
  const leadProjects = rankProjectsByAttention(snapshot, alertFeed.alerts)
    .slice(0, 3)
    .map((project) => project.name);
  const sections = ensureSections({
    whatHappened: [
      locale === "ru"
        ? `В контуре ${totalProjects} ${formatProjectNoun(totalProjects, locale)}; эскалации требуют ${atRiskProjects.length}, завершены ${completedProjects}.`
        : `${totalProjects} projects are in scope; ${atRiskProjects.length} require escalation and ${completedProjects} have already landed.`,
      overdueTasks > 0
        ? locale === "ru"
          ? `Открыты ${overdueTasks} ${formatTaskNoun(overdueTasks, locale, "overdue")}; основная концентрация в ${formatList(leadProjects, locale)}.`
          : `${overdueTasks} overdue tasks remain open, with the heaviest concentration in ${formatList(
              leadProjects,
              locale
            )}.`
        : locale === "ru"
          ? "Критического кластера просроченных задач в портфеле сейчас не видно."
          : "No overdue task cluster is currently visible in the portfolio.",
      locale === "ru"
        ? `Среднее здоровье портфеля ${averageHealth}/100, отклонение по затратам ${formatSignedPercent(
            budgetVarianceRatio,
            locale
          )} к плану на текущую дату.`
        : `Portfolio health averages ${averageHealth}/100 and spend is ${formatSignedPercent(
            budgetVarianceRatio,
            locale
          )} versus planned-to-date.`,
      locale === "ru"
        ? `Plan-vs-fact: SPI ${formatNullableEvmMetric(
            portfolioPlanFact.totals.spi,
            locale
          )}, CPI ${formatNullableEvmMetric(
            portfolioPlanFact.totals.cpi,
            locale
          )}, позади плана ${portfolioPlanFact.totals.projectsBehindPlan}.`
        : `Plan-vs-fact: SPI ${formatNullableEvmMetric(
            portfolioPlanFact.totals.spi,
            locale
          )}, CPI ${formatNullableEvmMetric(
            portfolioPlanFact.totals.cpi,
            locale
          )}, ${portfolioPlanFact.totals.projectsBehindPlan} projects are behind plan.`,
    ],
    whyItMatters: dedupe(
      alertFeed.alerts.map((alert) => alert.whyItMatters),
      3
    ),
    recommendedActions:
      alertFeed.recommendationsSummary.length > 0
        ? alertFeed.recommendationsSummary
        : [
            locale === "ru"
              ? "Сохранить текущий ритм управления и наблюдать за новыми отклонениями."
              : "Maintain the current cadence and monitor for new exceptions.",
          ],
  }, locale);
  const headline = atRiskProjects.length
    ? locale === "ru"
      ? `Основное давление в портфеле сосредоточено в ${atRiskProjects.length} ${formatProjectNoun(
          atRiskProjects.length,
          locale
        )}`
      : `Portfolio pressure is concentrated in ${atRiskProjects.length} project${atRiskProjects.length === 1 ? "" : "s"}`
    : locale === "ru"
      ? "Портфель в целом стабилен, проблемы локализованы"
      : "Portfolio is stable with localized issues only";
  const summary =
    locale === "ru"
      ? `${activeProjects} активных ${formatProjectNoun(activeProjects, locale)}, ${criticalProjects.size} с критическими сигналами, отклонение бюджета ${formatSignedPercent(
          budgetVarianceRatio,
          locale
        )}, ${overdueTasks} ${formatTaskNoun(overdueTasks, locale, "overdue")}.`
      : `${activeProjects} active projects, ${criticalProjects.size} with critical alerts, ${formatSignedPercent(
          budgetVarianceRatio,
          locale
        )} budget variance, ${overdueTasks} overdue tasks.`;
  const formats = buildFormats(
    locale === "ru" ? "Портфельный brief" : "Portfolio brief",
    headline,
    summary,
    sections,
    locale
  );

  return {
    kind: "portfolio",
    generatedAt: referenceDate.toISOString(),
    headline,
    summary,
    portfolio: {
      totalProjects,
      activeProjects,
      completedProjects,
      atRiskProjects: atRiskProjects.length,
      criticalProjects: criticalProjects.size,
      overdueTasks,
      averageHealth,
      budgetVariance: round(budgetVariance, 0),
      budgetVarianceRatio: round(budgetVarianceRatio, 3),
      planFact: {
        plannedProgress: portfolioPlanFact.totals.plannedProgress,
        actualProgress: portfolioPlanFact.totals.actualProgress,
        progressVariance: portfolioPlanFact.totals.progressVariance,
        cpi: portfolioPlanFact.totals.cpi,
        spi: portfolioPlanFact.totals.spi,
        projectsBehindPlan: portfolioPlanFact.totals.projectsBehindPlan,
        projectsOverBudget: portfolioPlanFact.totals.projectsOverBudget,
        staleFieldReportingProjects: portfolioPlanFact.totals.staleFieldReportingProjects,
      },
    },
    topAlerts: alertFeed.alerts,
    recommendationsSummary: alertFeed.recommendationsSummary,
    sections,
    formats,
  };
}

export function generateProjectBriefFromSnapshot(
  snapshot: ExecutiveSnapshot,
  projectId: string,
  options: BriefOptions = {}
): ProjectBrief {
  const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
  const locale = resolveBriefLocale(options.locale);
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    throw new Error(`Project "${projectId}" was not found.`);
  }

  const planFact = buildProjectPlanFactSummary(snapshot, projectId, {
    referenceDate,
  });

  const alerts = buildProjectAlerts(snapshot, projectId, {
    locale,
    referenceDate,
  }).slice(0, 5);
  const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);
  const overdueTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() < referenceDate.getTime()
  );
  const openRisks = snapshot.risks.filter(
    (risk) => risk.projectId === projectId && risk.status === "open"
  );
  const budgetVariance = planFact.budgetVariance;
  const budgetVarianceRatio = planFact.budgetVarianceRatio;
  const sections = ensureSections({
    whatHappened: [
      locale === "ru"
        ? `Прогресс проекта ${project.name} составляет ${project.progress}%, при этом открыты ${overdueTasks.length} ${formatTaskNoun(
            overdueTasks.length,
            locale,
            "overdue"
          )} и ${openRisks.length} ${formatRiskNoun(openRisks.length, locale, "open")}.`
        : `${project.name} is ${project.progress}% complete with ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} and ${openRisks.length} open risk${openRisks.length === 1 ? "" : "s"}.`,
      project.nextMilestone
        ? locale === "ru"
          ? `Следующая контрольная точка: ${project.nextMilestone.name} к ${formatShortDate(
              project.nextMilestone.date,
              locale
            )}`
          : `Next milestone is ${project.nextMilestone.name} on ${formatShortDate(
              project.nextMilestone.date,
              locale
            )}.`
        : locale === "ru"
          ? "Для проекта сейчас не зафиксирована активная контрольная точка."
          : "No active milestone is currently tracked for this project.",
      locale === "ru"
        ? `Отклонение по затратам ${formatSignedPercent(
            budgetVarianceRatio,
            locale
          )} к плану на текущую дату, индекс здоровья проекта ${project.health}/100.`
        : `Spend is ${formatSignedPercent(
            budgetVarianceRatio,
            locale
          )} versus planned-to-date and the project health score is ${project.health}/100.`,
      locale === "ru"
        ? `Plan-vs-fact: плановый прогресс ${planFact.plannedProgress}%, фактический ${planFact.actualProgress}%, SPI ${formatNullableEvmMetric(
            planFact.evm.spi,
            locale
          )}, CPI ${formatNullableEvmMetric(planFact.evm.cpi, locale)}.`
        : `Plan-vs-fact: planned progress ${planFact.plannedProgress}%, actual ${planFact.actualProgress}%, SPI ${formatNullableEvmMetric(
            planFact.evm.spi,
            locale
          )}, CPI ${formatNullableEvmMetric(planFact.evm.cpi, locale)}.`,
    ],
    whyItMatters:
      alerts.length > 0
        ? dedupe(
            alerts.map((alert) => alert.whyItMatters),
            3
          )
        : [
            locale === "ru"
              ? "Сейчас нет одного доминирующего сигнала, но проект всё равно требует наблюдения."
              : "No single signal dominates yet, but the project still requires monitoring.",
          ],
    recommendedActions:
      alerts.length > 0
        ? dedupe(alerts.map((alert) => alert.recommendedAction), 3)
        : [
            locale === "ru"
              ? "Сохранить текущий план и наблюдать за отклонением по срокам и затратам."
              : "Keep the current plan and monitor for schedule or cost drift.",
          ],
  }, locale);
  const headline =
    alerts[0]?.title ??
    (locale === "ru"
      ? `${project.name} не требует немедленного вмешательства руководства`
      : `${project.name} requires no immediate executive intervention`);
  const summary =
    locale === "ru"
      ? `Статус ${formatProjectStatus(project.status, locale)}, прогресс ${project.progress}%, ${overdueTasks.length} ${formatTaskNoun(
          overdueTasks.length,
          locale,
          "overdue"
        )}, ${openRisks.length} ${formatRiskNoun(openRisks.length, locale, "open")}, отклонение бюджета ${formatSignedPercent(
          budgetVarianceRatio,
          locale
        )}.`
      : `${project.status} status, ${project.progress}% progress, ${overdueTasks.length} overdue tasks, ${openRisks.length} open risks, ${formatSignedPercent(
          budgetVarianceRatio,
          locale
        )} budget variance.`;
  const formats = buildFormats(project.name, headline, summary, sections, locale);

  return {
    kind: "project",
    generatedAt: referenceDate.toISOString(),
    headline,
    summary,
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      progress: project.progress,
      health: project.health,
      overdueTasks: overdueTasks.length,
      openRisks: openRisks.length,
      budgetVariance: round(budgetVariance, 0),
      budgetVarianceRatio: round(budgetVarianceRatio, 3),
      nextMilestone: project.nextMilestone,
      planFact: summarizeProjectPlanFactForBrief(planFact),
    },
    topAlerts: alerts,
    recommendationsSummary: dedupe(
      alerts.map((alert) => `${project.name}: ${alert.recommendedAction}`),
      3
    ),
    sections,
    formats,
  };
}

export async function buildDemoPortfolioBrief(referenceDate: string | Date): Promise<PortfolioBrief> {
  const snapshot = await buildMockExecutiveSnapshot({ generatedAt: referenceDate });
  return generatePortfolioBriefFromSnapshot(snapshot, { referenceDate });
}

function rankProjectsByAttention(snapshot: ExecutiveSnapshot, alertIds: Array<{ projectId?: string }>): ExecutiveProject[] {
  const attentionScores = new Map<string, number>();

  for (const project of snapshot.projects) {
    attentionScores.set(project.id, 0);
  }

  for (const alert of alertIds) {
    if (!alert.projectId) continue;
    attentionScores.set(
      alert.projectId,
      (attentionScores.get(alert.projectId) ?? 0) + 1
    );
  }

  return [...snapshot.projects].sort((left, right) => {
    const delta =
      (attentionScores.get(right.id) ?? 0) - (attentionScores.get(left.id) ?? 0);
    if (delta !== 0) {
      return delta;
    }

    return left.health - right.health;
  });
}

function buildFormats(
  title: string,
  headline: string,
  summary: string,
  sections: BriefSections,
  locale: BriefLocale
): BriefFormats {
  const dashboardHighlights = [
    ...sections.whatHappened.slice(0, 2),
    ...sections.recommendedActions.slice(0, 1),
  ];
  const sectionHeadings =
    locale === "ru"
      ? {
          whatHappened: "Что произошло:",
          whyItMatters: "Почему это важно:",
          recommendedActions: "Что делать:",
        }
      : {
          whatHappened: "What happened:",
          whyItMatters: "Why it matters:",
          recommendedActions: "Recommended actions:",
        };
  const telegramDigest = [
    `${title}`,
    headline,
    "",
    sectionHeadings.whatHappened,
    ...sections.whatHappened.map((line) => `- ${line}`),
    "",
    sectionHeadings.whyItMatters,
    ...sections.whyItMatters.map((line) => `- ${line}`),
    "",
    sectionHeadings.recommendedActions,
    ...sections.recommendedActions.map((line) => `- ${line}`),
  ].join("\n");
  const emailDigestBody = [
    headline,
    "",
    summary,
    "",
    sectionHeadings.whatHappened.replace(":", ""),
    ...sections.whatHappened.map((line) => `- ${line}`),
    "",
    sectionHeadings.whyItMatters.replace(":", ""),
    ...sections.whyItMatters.map((line) => `- ${line}`),
    "",
    sectionHeadings.recommendedActions.replace(":", ""),
    ...sections.recommendedActions.map((line) => `- ${line}`),
  ].join("\n");

  return {
    dashboardCard: {
      title,
      summary,
      highlights: dashboardHighlights,
    },
    telegramDigest,
    emailDigest: {
      subject: headline,
      preview: summary,
      body: emailDigestBody,
    },
  };
}

function ensureSections(
  sections: BriefSections,
  locale: BriefLocale
): BriefSections {
  return {
    whatHappened:
      sections.whatHappened.filter(Boolean).length > 0
        ? sections.whatHappened.filter(Boolean)
        : [
            locale === "ru"
              ? "В последних данных портфеля не обнаружено материальных изменений."
              : "No material change detected in the latest portfolio data.",
          ],
    whyItMatters:
      sections.whyItMatters.filter(Boolean).length > 0
        ? sections.whyItMatters.filter(Boolean)
        : [
            locale === "ru"
              ? "Сейчас не видно существенного управленческого эффекта."
              : "No significant management impact is visible at the moment.",
          ],
    recommendedActions:
      sections.recommendedActions.filter(Boolean).length > 0
        ? sections.recommendedActions.filter(Boolean)
        : [
            locale === "ru"
              ? "Продолжать мониторинг в текущем ритме."
              : "Continue monitoring with the current cadence.",
          ],
  };
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 0);
}

function dedupe(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      result.push(value);
      seen.add(value);
    }

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatNullableEvmMetric(value: number | null, locale: BriefLocale) {
  if (value === null) {
    return locale === "ru" ? "н/д" : "n/a";
  }

  return value.toFixed(2);
}
