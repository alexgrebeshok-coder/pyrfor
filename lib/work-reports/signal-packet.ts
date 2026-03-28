import { getAgentById } from "@/lib/ai/agents";
import { loadServerAIContext } from "@/lib/ai/server-context";
import { createServerAIRun } from "@/lib/ai/server-runs";
import type { AIContextSnapshot, AIRunInput, AIRunRecord } from "@/lib/ai/types";
import { buildProjectAlerts } from "@/lib/alerts/scoring";
import { resolveBriefLocale } from "@/lib/briefs/locale";
import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import { type ExecutiveSnapshot } from "@/lib/briefs/types";
import { buildProjectPlanFactSummary } from "@/lib/plan-fact/service";
import type { ProjectPlanFactSummary } from "@/lib/plan-fact/types";
import type { Locale } from "@/lib/translations";

import { getWorkReportById } from "./service";
import type {
  WorkReportActionPurpose,
  WorkReportSignalPacket,
  WorkReportSignalPacketRequest,
  WorkReportSignalRunBlueprint,
  WorkReportSignalSnapshot,
  WorkReportView,
} from "./types";

interface WorkReportSignalPacketDeps {
  createRun?: (input: AIRunInput) => Promise<AIRunRecord>;
  loadContext?: (input: {
    projectId: string;
    locale?: Locale;
    interfaceLocale?: Locale;
    subtitle?: string;
    title?: string;
  }) => Promise<AIContextSnapshot>;
  loadSnapshot?: (input: { projectId: string }) => Promise<ExecutiveSnapshot>;
  loadWorkReport?: (reportId: string) => Promise<WorkReportView | null>;
  now?: () => Date;
  packetIdFactory?: () => string;
}

export async function createWorkReportSignalPacket(
  reportId: string,
  request: WorkReportSignalPacketRequest = {},
  deps: WorkReportSignalPacketDeps = {}
): Promise<WorkReportSignalPacket> {
  const now = deps.now ?? (() => new Date());
  const packetIdFactory = deps.packetIdFactory ?? createPacketId;
  const createRun = deps.createRun ?? createServerAIRun;
  const loadWorkReport = deps.loadWorkReport ?? getWorkReportById;
  const loadSnapshot = deps.loadSnapshot ?? ((input: { projectId: string }) => loadExecutiveSnapshot(input));
  const loadContext =
    deps.loadContext ??
    ((input: {
      projectId: string;
      locale?: Locale;
      interfaceLocale?: Locale;
      subtitle?: string;
      title?: string;
    }) =>
      loadServerAIContext({
        projectId: input.projectId,
        locale: input.locale,
        interfaceLocale: input.interfaceLocale,
        pathname: `/projects/${input.projectId}`,
        subtitle: input.subtitle,
        title: input.title,
      }));

  const report = await loadWorkReport(reportId);
  if (!report) {
    throw new Error(`Work report "${reportId}" was not found.`);
  }

  if (report.status !== "approved") {
    throw new Error("Only approved work reports can be converted into action packets.");
  }

  const [snapshot, context] = await Promise.all([
    loadSnapshot({ projectId: report.projectId }),
    loadContext({
      projectId: report.projectId,
      locale: request.locale,
      interfaceLocale: request.interfaceLocale,
      subtitle: `Field signal packet: ${report.reportNumber}`,
      title: report.project.name,
    }),
  ]);

  const project = context.project;
  if (!project) {
    throw new Error(`Project "${report.projectId}" was not found.`);
  }

  const packetId = packetIdFactory();
  const planFact = buildProjectPlanFactSummary(snapshot, report.projectId);
  const signal = buildSignalSnapshot(report, snapshot, planFact, request.locale ?? context.locale);
  const blueprints = buildWorkReportSignalRunBlueprints(
    context,
    report,
    signal,
    request.locale,
    {
      packetId,
    }
  );

  const runs = await Promise.all(
    blueprints.map(async (blueprint) => ({
      purpose: blueprint.purpose,
      label: blueprint.label,
      pollPath: "/api/ai/runs",
      run: await createRun(blueprint.input),
    }))
  );

  return {
    packetId,
    createdAt: now().toISOString(),
    reportId: report.id,
    reportNumber: report.reportNumber,
    reportStatus: report.status,
    projectId: report.projectId,
    projectName: report.project.name,
    signal,
    runs: runs.map((entry) => ({
      ...entry,
      pollPath: `/api/ai/runs/${entry.run.id}`,
    })),
  };
}

export function buildWorkReportSignalRunBlueprints(
  context: AIContextSnapshot,
  report: WorkReportView,
  signal: WorkReportSignalSnapshot,
  locale: Locale = context.locale,
  traceMeta: { packetId: string }
): WorkReportSignalRunBlueprint[] {
  const planner = requireAgent("execution-planner");
  const riskResearcher = requireAgent("risk-researcher");
  const statusReporter = requireAgent("status-reporter");
  const projectName = context.project?.name ?? context.activeContext.title;
  const topAlertLines =
    signal.topAlerts.length > 0
      ? signal.topAlerts
          .map(
            (alert, index) =>
              `${index + 1}. [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.summary}`
          )
          .join("\n")
      : locale === "ru"
        ? "1. Нет активных проектных alerts, но нужно проверить handoff по смене."
        : locale === "zh"
          ? "1. 当前没有激活告警，但仍需检查班次交接。"
          : "1. No active project alerts, but the shift handoff still requires follow-up.";

  const issuesBlock = report.issues?.trim() || emptyState(locale, "issues");
  const nextDayPlanBlock = report.nextDayPlan?.trim() || emptyState(locale, "nextDayPlan");
  const weatherBlock = report.weather?.trim() || emptyState(locale, "weather");

  return [
    createBlueprint("tasks", "Execution patch", {
      agent: planner,
      context,
      source: {
        workflow: "work_report_signal_packet",
        purpose: "tasks",
        packetId: traceMeta.packetId,
        packetLabel: `${report.reportNumber} · ${report.section}`,
        entityType: "work_report",
        entityId: report.id,
        entityLabel: `${report.reportNumber} · ${report.section}`,
        projectId: report.projectId,
        projectName: report.project.name,
      },
      prompt: [
        `Work-report action packet for project ${projectName}.`,
        `Report ${report.reportNumber} (${report.status}) from ${report.section} on ${report.reportDate}.`,
        "Update the execution plan with concrete follow-up tasks from the field report.",
        "Prefer task updates or short recovery tasks with owners, due dates, and next 72-hour actions.",
        `Signal headline: ${signal.headline}.`,
        `Signal summary: ${signal.summary}.`,
        `Plan vs fact: planned ${signal.planFact.plannedProgress}%, actual ${signal.planFact.actualProgress}%, variance ${signal.planFact.progressVariance} pp, pending field reviews ${signal.planFact.pendingWorkReports}.`,
        "Top project alerts:",
        topAlertLines,
        "Work performed:",
        report.workDescription,
        "Issues / blockers:",
        issuesBlock,
        "Next day plan:",
        nextDayPlanBlock,
        "Weather / conditions:",
        weatherBlock,
      ].join("\n"),
    }),
    createBlueprint("risks", "Risk additions", {
      agent: riskResearcher,
      context,
      source: {
        workflow: "work_report_signal_packet",
        purpose: "risks",
        packetId: traceMeta.packetId,
        packetLabel: `${report.reportNumber} · ${report.section}`,
        entityType: "work_report",
        entityId: report.id,
        entityLabel: `${report.reportNumber} · ${report.section}`,
        projectId: report.projectId,
        projectName: report.project.name,
      },
      prompt: [
        `Work-report risk packet for project ${projectName}.`,
        `Report ${report.reportNumber} (${report.status}) from ${report.section} on ${report.reportDate}.`,
        "Raise risks or blockers based on the field report and latest project signals.",
        "Focus on schedule, budget, supplier, access, quality, safety, manpower, equipment, and weather exposure.",
        `Signal headline: ${signal.headline}.`,
        `Signal summary: ${signal.summary}.`,
        "Top project alerts:",
        topAlertLines,
        "Work performed:",
        report.workDescription,
        "Issues / blockers:",
        issuesBlock,
        "Next day plan:",
        nextDayPlanBlock,
      ].join("\n"),
    }),
    createBlueprint("status", "Executive status draft", {
      agent: statusReporter,
      context,
      source: {
        workflow: "work_report_signal_packet",
        purpose: "status",
        packetId: traceMeta.packetId,
        packetLabel: `${report.reportNumber} · ${report.section}`,
        entityType: "work_report",
        entityId: report.id,
        entityLabel: `${report.reportNumber} · ${report.section}`,
        projectId: report.projectId,
        projectName: report.project.name,
      },
      prompt: [
        `Work-report executive update for project ${projectName}.`,
        `Report ${report.reportNumber} (${report.status}) from ${report.section} on ${report.reportDate}.`,
        "Draft a concise management status update from the field report and latest project signals.",
        "Summarize confirmed progress, blockers, top risks, budget/schedule pressure, and the next management ask.",
        `Signal headline: ${signal.headline}.`,
        `Signal summary: ${signal.summary}.`,
        "Top project alerts:",
        topAlertLines,
        "Work performed:",
        report.workDescription,
        "Issues / blockers:",
        issuesBlock,
        "Next day plan:",
        nextDayPlanBlock,
      ].join("\n"),
    }),
  ];
}

function buildSignalSnapshot(
  report: WorkReportView,
  snapshot: ExecutiveSnapshot,
  planFact: ProjectPlanFactSummary,
  locale: Locale
): WorkReportSignalSnapshot {
  const topAlerts = buildProjectAlerts(snapshot, report.projectId, {
    locale: resolveBriefLocale(locale),
  }).slice(0, 3);
  const primaryAlert = topAlerts[0];

  return {
    headline:
      primaryAlert?.title ??
      (report.status === "approved"
        ? copy(locale, {
            ru: "Полевой отчёт подтверждает текущий execution state",
            en: "Field report confirms the current execution state",
            zh: "现场报告确认了当前执行状态",
          })
        : copy(locale, {
            ru: "Полевой отчёт требует быстрых управленческих действий",
            en: "Field report requires rapid management follow-up",
            zh: "现场报告需要快速管理跟进",
          })),
    summary: buildSignalSummary(report, planFact, primaryAlert?.summary, locale),
    reportId: report.id,
    reportNumber: report.reportNumber,
    reportStatus: report.status,
    reportDate: report.reportDate,
    section: report.section,
    projectId: report.projectId,
    projectName: report.project.name,
    planFact: {
      status: planFact.status,
      plannedProgress: planFact.plannedProgress,
      actualProgress: planFact.actualProgress,
      progressVariance: planFact.progressVariance,
      cpi: planFact.evm.cpi,
      spi: planFact.evm.spi,
      budgetVarianceRatio: planFact.budgetVarianceRatio,
      pendingWorkReports: planFact.evidence.pendingWorkReports,
      daysSinceLastApprovedReport: planFact.evidence.daysSinceLastApprovedReport,
    },
    topAlerts: topAlerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      category: alert.category,
      summary: alert.summary,
    })),
  };
}

function buildSignalSummary(
  report: WorkReportView,
  planFact: ProjectPlanFactSummary,
  alertSummary: string | undefined,
  locale: Locale
) {
  const base = copy(locale, {
    ru: `${report.reportNumber} по участку ${report.section} фиксирует факт смены и требует проверки handoff между полем и планом.`,
    en: `${report.reportNumber} for section ${report.section} captures the latest field facts and needs a clean handoff into the plan.`,
    zh: `${report.reportNumber} 已记录 ${report.section} 的现场事实，需要把这些信息准确传递到计划层。`,
  });
  const variance = copy(locale, {
    ru: `Отклонение plan-vs-fact составляет ${planFact.progressVariance} п.п., pending review: ${planFact.evidence.pendingWorkReports}.`,
    en: `Plan-vs-fact variance is ${planFact.progressVariance} pp with ${planFact.evidence.pendingWorkReports} reports pending review.`,
    zh: `计划与事实偏差为 ${planFact.progressVariance} 个百分点，待审核报告 ${planFact.evidence.pendingWorkReports} 份。`,
  });

  return [base, variance, alertSummary].filter(Boolean).join(" ");
}

function createBlueprint(
  purpose: WorkReportActionPurpose,
  label: string,
  input: AIRunInput
): WorkReportSignalRunBlueprint {
  return {
    purpose,
    label,
    input,
  };
}

function requireAgent(agentId: string) {
  const agent = getAgentById(agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" was not found.`);
  }

  return agent;
}

function emptyState(locale: Locale, kind: "issues" | "nextDayPlan" | "weather") {
  if (locale === "ru") {
    return kind === "issues"
      ? "Явные блокеры не указаны."
      : kind === "nextDayPlan"
        ? "План на следующий день не зафиксирован."
        : "Погодные условия не указаны.";
  }

  if (locale === "zh") {
    return kind === "issues"
      ? "未明确说明阻塞项。"
      : kind === "nextDayPlan"
        ? "未记录次日计划。"
        : "未记录天气条件。";
  }

  return kind === "issues"
    ? "No explicit blockers were recorded."
    : kind === "nextDayPlan"
      ? "The next-day plan was not recorded."
      : "Weather conditions were not recorded.";
}

function copy<T>(locale: Locale, map: { ru: T; en: T; zh: T }) {
  return map[locale] ?? map.ru;
}

function createPacketId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `work-report-packet-${crypto.randomUUID()}`;
  }

  return `work-report-packet-${Math.random().toString(36).slice(2, 10)}`;
}
