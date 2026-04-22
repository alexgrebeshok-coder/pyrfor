import { format } from "date-fns";

import type { AIChatContextBundle } from './context-builder';
import type {
  AIConfidenceSummary,
  AIEvidenceFact,
  AIRunInput,
  AIRunResult,
} from './types';
import type { EvidenceListResult, EvidenceRecordView } from '../evidence/types';

type GroundingLocale = "ru" | "en" | "zh";

interface GroundingResult {
  facts: AIEvidenceFact[];
  confidence: AIConfidenceSummary;
}

const COPY: Record<
  GroundingLocale,
  {
    averageConfidence: string;
    basisPrefix: string;
    blockedTasks: string;
    confidenceBands: Record<"low" | "medium" | "high" | "strong", string>;
    confidenceLabel: string;
    evidenceLedger: string;
    execution: string;
    facts: string;
    lastObserved: string;
    noEvidence: string;
    observed: string;
    portfolio: string;
    project: string;
    reporting: string;
    risks: string;
    reported: string;
    records: string;
    verified: string;
    overdueTasks: string;
  }
> = {
  ru: {
    averageConfidence: "Средняя уверенность",
    basisPrefix: "Основано на",
    blockedTasks: "блокеров",
    confidenceBands: {
      low: "Низкая",
      medium: "Средняя",
      high: "Высокая",
      strong: "Очень высокая",
    },
    confidenceLabel: "Уверенность",
    evidenceLedger: "Ледгер evidence",
    execution: "Исполнение",
    facts: "Факты",
    lastObserved: "Последнее наблюдение",
    noEvidence: "Пока нет подтверждённых evidence-записей",
    observed: "наблюдается",
    portfolio: "Портфель",
    project: "Проект",
    reporting: "Отчётность",
    risks: "Риски",
    reported: "заявлено",
    records: "записей",
    verified: "подтверждено",
    overdueTasks: "просрочено",
  },
  en: {
    averageConfidence: "Average confidence",
    basisPrefix: "Grounded in",
    blockedTasks: "blocked",
    confidenceBands: {
      low: "Low",
      medium: "Medium",
      high: "High",
      strong: "Strong",
    },
    confidenceLabel: "Confidence",
    evidenceLedger: "Evidence ledger",
    execution: "Execution",
    facts: "Facts",
    lastObserved: "Last observed",
    noEvidence: "No verified evidence records yet",
    observed: "observed",
    portfolio: "Portfolio",
    project: "Project",
    reporting: "Reporting",
    risks: "Risks",
    reported: "reported",
    records: "records",
    verified: "verified",
    overdueTasks: "overdue",
  },
  zh: {
    averageConfidence: "平均置信度",
    basisPrefix: "基于",
    blockedTasks: "个阻塞项",
    confidenceBands: {
      low: "低",
      medium: "中",
      high: "高",
      strong: "很高",
    },
    confidenceLabel: "置信度",
    evidenceLedger: "证据账本",
    execution: "执行",
    facts: "事实",
    lastObserved: "最后观察",
    noEvidence: "暂时没有已验证的证据记录",
    observed: "已观察",
    portfolio: "组合",
    project: "项目",
    reporting: "汇报",
    risks: "风险",
    reported: "已提交",
    records: "条记录",
    verified: "已验证",
    overdueTasks: "已逾期",
  },
};

const LOCALE_TAGS: Record<GroundingLocale, string> = {
  ru: "ru-RU",
  en: "en-US",
  zh: "zh-CN",
};

export function buildChatGrounding(bundle: AIChatContextBundle): GroundingResult {
  const locale = resolveLocale(bundle.locale);
  const copy = COPY[locale];
  const records = bundle.scope === "project" && bundle.projectId
    ? bundle.evidence.records.filter(
        (record) => record.projectId === bundle.projectId || record.projectId === null
      )
    : bundle.evidence.records;

  const facts: AIEvidenceFact[] = [];
  facts.push(buildLedgerSummaryFact(bundle.evidence, copy));

  if (records.length > 0) {
    facts.push(
      ...records
        .slice(0, 3)
        .map((record) => buildEvidenceRecordFact(record, copy))
        .filter((fact): fact is AIEvidenceFact => fact !== null)
    );
  } else {
    facts.push({
      label: copy.facts,
      value: copy.noEvidence,
      href: "/work-reports",
      meta: copy.evidenceLedger,
    });
  }

  return {
    facts: facts.slice(0, 4),
    confidence: buildEvidenceConfidence(bundle.evidence, records, copy, locale),
  };
}

export function attachRunGrounding(result: AIRunResult, input: AIRunInput): AIRunResult {
  const locale = resolveLocale(input.context.locale);
  const copy = COPY[locale];
  const grounded = buildContextGrounding(input, copy, locale);
  const resultFacts = result.facts && result.facts.length > 0 ? result.facts : grounded.facts;
  const resultConfidence = result.confidence ?? grounded.confidence;
  const proposal = result.proposal;

  return {
    ...result,
    facts: resultFacts,
    confidence: resultConfidence,
    proposal:
      proposal && proposal !== null
        ? {
            ...proposal,
            facts: proposal.facts && proposal.facts.length > 0 ? proposal.facts : resultFacts,
            confidence: proposal.confidence ?? resultConfidence,
          }
        : proposal,
  };
}

function buildLedgerSummaryFact(
  evidence: EvidenceListResult,
  copy: (typeof COPY)[GroundingLocale]
): AIEvidenceFact {
  const summary = evidence.summary;
  const value =
    summary.total > 0
      ? [
          `${summary.total} ${copy.records}`,
          `${summary.verified} ${copy.verified}`,
          `${summary.observed} ${copy.observed}`,
          `${summary.reported} ${copy.reported}`,
        ].join(" · ")
      : copy.noEvidence;

  return {
    label: copy.evidenceLedger,
    value,
    meta: summary.averageConfidence !== null ? `${copy.averageConfidence}: ${formatPercent(summary.averageConfidence)}` : undefined,
  };
}

function buildEvidenceRecordFact(
  record: EvidenceRecordView,
  copy: (typeof COPY)[GroundingLocale]
): AIEvidenceFact | null {
  const label = normalizeLabel(record.sourceRef ?? record.title ?? record.entityRef);
  const value = normalizeLabel(record.summary ?? record.sourceType);
  if (!label || !value) {
    return null;
  }

  return {
    label,
    value,
    href: buildEvidenceRecordHref(record),
    meta: `${normalizeVerificationStatus(record.verificationStatus, copy)} · ${formatPercent(record.confidence)}`,
  };
}

function buildEvidenceConfidence(
  evidence: EvidenceListResult,
  records: EvidenceRecordView[],
  copy: (typeof COPY)[GroundingLocale],
  locale: GroundingLocale
): AIConfidenceSummary {
  const summary = evidence.summary;
  const total = Math.max(summary.total, records.length);
  const averageConfidence = summary.averageConfidence ?? fallbackAverageConfidence(records);
  const verificationRatio =
    total > 0 ? (summary.verified + summary.observed * 0.6 + summary.reported * 0.35) / total : 0;
  const densityBoost = Math.min(total, 6) * 0.04;
  const score = clamp(
    Math.round(averageConfidence * 68 + verificationRatio * 18 + densityBoost * 100),
    30,
    98
  );
  const band = score >= 85 ? "strong" : score >= 70 ? "high" : score >= 50 ? "medium" : "low";
  const basis = buildEvidenceBasis(summary, records, copy, locale);

  return {
    score,
    band,
    label: copy.confidenceBands[band],
    rationale:
      total > 0
        ? `${copy.basisPrefix} ${basis.join(" · ")}.`
        : copy.noEvidence,
    basis,
  };
}

function buildContextGrounding(
  input: AIRunInput,
  copy: (typeof COPY)[GroundingLocale],
  locale: GroundingLocale
): GroundingResult {
  const project = resolveProject(input.context);
  const projectTasks = project
    ? (input.context.projectTasks ?? input.context.tasks).filter((task) => task.projectId === project.id)
    : input.context.tasks;
  const openTasks = projectTasks.filter((task) => task.status !== "done");
  const blockedTasks = projectTasks.filter((task) => task.status === "blocked");
  const overdueTasks = openTasks.filter((task) => isOverdue(task.dueDate));
  const openRisks = project
    ? input.context.risks.filter((risk) => risk.projectId === project.id && risk.status === "open")
    : input.context.risks.filter((risk) => risk.status === "open");
  const atRiskProjects = input.context.projects.filter((candidate) => candidate.status === "at-risk");

  const facts: AIEvidenceFact[] = [];

  if (project) {
    facts.push({
      label: copy.project,
      value: `${project.name} · ${project.health}% health · ${project.progress}% progress`,
      href: `/projects/${project.id}`,
      meta: project.priority,
    });
    facts.push({
      label: copy.execution,
      value: `${openTasks.length} open tasks · ${blockedTasks.length} ${copy.blockedTasks} · ${overdueTasks.length} ${copy.overdueTasks}`,
      href: `/tasks?query=${encodeURIComponent(project.name)}`,
      meta: openTasks.length > 0 ? openTasks[0].title : undefined,
    });
    facts.push({
      label: copy.risks,
      value:
        openRisks.length > 0
          ? `${openRisks.length} open risks · ${openRisks[0].title}`
          : "0 open risks",
      href: "/risks",
      meta: openRisks[0]?.owner,
    });
    facts.push({
      label: copy.reporting,
      value: `${input.context.notifications.length} notifications · ${input.context.team.length} team members`,
      href: "/work-reports",
      meta: project.nextMilestone ? `${project.nextMilestone.name} · ${formatDate(project.nextMilestone.date, locale)}` : undefined,
    });
  } else {
    facts.push({
      label: copy.portfolio,
      value: `${input.context.projects.length} projects · ${atRiskProjects.length} at risk`,
      href: "/projects",
      meta: atRiskProjects[0]?.name,
    });
    facts.push({
      label: copy.execution,
      value: `${openTasks.length} open tasks · ${blockedTasks.length} ${copy.blockedTasks} · ${overdueTasks.length} ${copy.overdueTasks}`,
      href: "/tasks",
      meta: openTasks[0]?.title,
    });
    facts.push({
      label: copy.risks,
      value: `${openRisks.length} open risks`,
      href: "/risks",
      meta: openRisks[0]?.title,
    });
    facts.push({
      label: copy.reporting,
      value: `${input.context.notifications.length} notifications`,
      href: "/work-reports",
      meta: input.context.notifications[0]?.title,
    });
  }

  return {
    facts: facts.slice(0, 4),
    confidence: buildContextConfidence(
      input,
      project,
      openTasks,
      blockedTasks,
      overdueTasks,
      openRisks,
      atRiskProjects,
      copy
    ),
  };
}

function buildContextConfidence(
  input: AIRunInput,
  project: ReturnType<typeof resolveProject>,
  openTasks: AIRunInput["context"]["tasks"],
  blockedTasks: AIRunInput["context"]["tasks"],
  overdueTasks: AIRunInput["context"]["tasks"],
  openRisks: AIRunInput["context"]["risks"],
  atRiskProjects: AIRunInput["context"]["projects"],
  copy: (typeof COPY)[GroundingLocale]
): AIConfidenceSummary {
  const projectCount = input.context.projects.length;
  const taskCount = openTasks.length;
  const riskCount = openRisks.length;
  const blockedCount = blockedTasks.length;
  const overdueCount = overdueTasks.length;
  const score = clamp(
    Math.round(
      (project ? 48 : 42) +
        Math.min(taskCount, 6) * 4 +
        Math.min(blockedCount, 3) * 8 +
        Math.min(overdueCount, 3) * 6 +
        Math.min(riskCount, 3) * 7 +
        Math.min(atRiskProjects.length, 4) * 4 +
        (project ? Math.max(0, 10 - Math.floor(project.health / 12)) : 0)
    ),
    35,
    97
  );
  const band = score >= 85 ? "strong" : score >= 70 ? "high" : score >= 50 ? "medium" : "low";
  const basis = buildContextBasis(
    project,
    projectCount,
    taskCount,
    blockedCount,
    overdueCount,
    riskCount,
    atRiskProjects.length,
    copy
  );

  return {
    score,
    band,
    label: copy.confidenceBands[band],
    rationale:
      project
        ? `${copy.basisPrefix} ${basis.join(" · ")}.`
        : `${copy.basisPrefix} ${basis.join(" · ")}.`,
    basis,
  };
}

function buildContextBasis(
  project: ReturnType<typeof resolveProject>,
  projectCount: number,
  taskCount: number,
  blockedCount: number,
  overdueCount: number,
  riskCount: number,
  atRiskCount: number,
  copy: (typeof COPY)[GroundingLocale]
) {
  const basis = [
    project ? `${project.name}` : `${projectCount} ${copy.portfolio.toLowerCase()}`,
    `${taskCount} tasks`,
    `${blockedCount} ${copy.blockedTasks}`,
    `${overdueCount} ${copy.overdueTasks}`,
    `${riskCount} ${copy.risks.toLowerCase()}`,
  ];

  if (!project) {
    basis.unshift(`${atRiskCount} at risk`);
  } else {
    basis.unshift(`${project.health}% health`);
  }

  return basis.filter((item) => item.trim().length > 0).slice(0, 4);
}

function buildEvidenceBasis(
  summary: EvidenceListResult["summary"],
  records: EvidenceRecordView[],
  copy: (typeof COPY)[GroundingLocale],
  locale: GroundingLocale
) {
  const basis = [
    `${Math.max(summary.total, records.length)} ${copy.records}`,
    `${summary.verified} ${copy.verified}`,
    `${summary.observed} ${copy.observed}`,
    `${summary.reported} ${copy.reported}`,
  ];

  if (summary.averageConfidence !== null) {
    basis.push(`${copy.averageConfidence} ${formatPercent(summary.averageConfidence)}`);
  }

  if (summary.lastObservedAt) {
    basis.push(`${copy.lastObserved}: ${formatDate(summary.lastObservedAt, locale)}`);
  }

  return basis.slice(0, 4);
}

function buildEvidenceRecordHref(record: EvidenceRecordView) {
  switch (record.entityType) {
    case "work_report":
    case "video_fact":
      return `/work-reports?query=${encodeURIComponent(record.sourceRef ?? record.entityRef)}`;
    case "task":
      return `/tasks?query=${encodeURIComponent(record.title)}`;
    case "gps_session":
      return "/field-operations";
    case "project":
      return record.projectId ? `/projects/${record.projectId}` : "/projects";
    default:
      return record.projectId ? `/projects/${record.projectId}` : undefined;
  }
}

function normalizeVerificationStatus(
  status: EvidenceRecordView["verificationStatus"],
  copy: (typeof COPY)[GroundingLocale]
) {
  switch (status) {
    case "verified":
      return copy.verified;
    case "observed":
      return copy.observed;
    case "reported":
    default:
      return copy.reported;
  }
}

function resolveProject(context: AIRunInput["context"]) {
  return (
    context.project ??
    (context.activeContext.projectId
      ? context.projects.find((project) => project.id === context.activeContext.projectId)
      : undefined) ??
    null
  );
}

function resolveLocale(locale: string | null | undefined): GroundingLocale {
  if (locale === "ru" || locale === "en" || locale === "zh") {
    return locale;
  }

  return "en";
}

function formatDate(value: string, locale: GroundingLocale) {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value * 100)}%`;
}

function fallbackAverageConfidence(records: EvidenceRecordView[]) {
  if (records.length === 0) {
    return 0.35;
  }

  const total = records.reduce((sum, record) => sum + record.confidence, 0);
  return total / records.length;
}

function isOverdue(value: string) {
  return value <= format(new Date(), "yyyy-MM-dd");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLabel(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
