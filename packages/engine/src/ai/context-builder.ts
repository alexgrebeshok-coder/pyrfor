import { buildAlertFeed } from '../alerts/scoring';
import {
  formatCurrency,
  formatList,
  formatProjectNoun,
  formatProjectStatus,
  formatShortDate,
  formatSignedPercent,
  resolveBriefLocale,
  type BriefLocale,
} from '../briefs/locale';
import { buildMockExecutiveSnapshot, loadExecutiveSnapshot } from '../briefs/snapshot';
import type {
  AlertFeed,
  ExecutiveProject,
  ExecutiveSnapshot,
  ExecutiveWorkReport,
} from '../briefs/types';
import {
  getEvidenceLedgerOverview,
  summarizeEvidenceRecords,
} from '../evidence/service';
import type { EvidenceListResult, EvidenceQuery, EvidenceRecordView } from '../evidence/types';
import { logger } from '../observability/logger';
import {
  buildPortfolioPlanFactSummary,
  buildProjectPlanFactSummary,
} from '../plan-fact/service';
import type {
  PortfolioPlanFactSummary,
  ProjectPlanFactSummary,
} from '../plan-fact/types';

export type AIChatFocus =
  | "general"
  | "financial"
  | "risk"
  | "execution"
  | "team"
  | "reporting"
  | "evidence";

export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIChatContextSection {
  title: string;
  bullets: string[];
}

export interface AIChatContextBundle {
  source: "live" | "mock";
  locale: BriefLocale;
  scope: "portfolio" | "project";
  focus: AIChatFocus;
  generatedAt: string;
  projectId: string | null;
  projectName: string | null;
  projectStatus: string | null;
  summary: string;
  sections: AIChatContextSection[];
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  evidence: EvidenceListResult;
  alertFeed: AlertFeed;
  systemPrompt: string;
}

export interface AIChatContextInput {
  messages: AIChatMessage[];
  projectId?: string;
  locale?: string;
}

export interface AIChatContextDeps {
  loadSnapshot?: (filter?: {
    generatedAt?: string | Date;
    projectId?: string;
  }) => Promise<ExecutiveSnapshot>;
  loadMockSnapshot?: (filter?: {
    generatedAt?: string | Date;
    projectId?: string;
  }) => Promise<ExecutiveSnapshot>;
  loadEvidence?: (query?: EvidenceQuery) => Promise<EvidenceListResult>;
}

const SECTION_LIMITS = {
  alerts: 4,
  evidence: 4,
  team: 3,
  projects: 3,
};

export async function buildAIChatContextBundle(
  input: AIChatContextInput,
  deps: AIChatContextDeps = {}
): Promise<AIChatContextBundle> {
  const messageText = extractLatestUserMessage(input.messages);
  const locale = resolveBriefLocale(detectChatLocale(messageText, input.locale));
  const focus = detectAIChatFocus(messageText);
  const snapshotResult = await loadSnapshotWithFallback(
    input.projectId,
    deps
  );
  const snapshot = snapshotResult.snapshot;
  const resolvedProjectId =
    input.projectId ?? inferProjectIdFromMessage(snapshot.projects, messageText);
  const projectIdForContext = resolvedProjectId ?? undefined;
  const project = projectIdForContext
    ? snapshot.projects.find((candidate) => candidate.id === projectIdForContext) ?? null
    : null;

  if (input.projectId && !project) {
    throw new Error(`Project "${input.projectId}" was not found.`);
  }

  const scope = projectIdForContext ? "project" : "portfolio";
  const planFact = scope === "project" && projectIdForContext
    ? buildProjectPlanFactSummary(snapshot, projectIdForContext)
    : buildPortfolioPlanFactSummary(snapshot);
  const alertFeed = buildAlertFeed(snapshot, {
    locale,
    limit: scope === "project" ? SECTION_LIMITS.alerts : SECTION_LIMITS.alerts + 1,
    projectId: scope === "project" ? projectIdForContext : undefined,
    referenceDate: snapshot.generatedAt,
  });
  const evidence = await loadEvidenceWithFallback(
    snapshot,
    projectIdForContext ?? null,
    focus,
    deps
  );
  const summary = buildSummaryLine({
    locale,
    planFact,
    project,
    scope,
    alertFeed,
  });
  const sections = buildSections({
    alertFeed,
    evidence,
    focus,
    locale,
    planFact,
    project,
    scope,
    snapshot,
  });
  const systemPrompt = buildSystemPrompt({
    focus,
    locale,
    sections,
    summary,
    scope,
  });

  return {
    source: snapshotResult.source,
    locale,
    scope,
    focus,
    generatedAt: snapshot.generatedAt,
    projectId: projectIdForContext ?? null,
    projectName: project?.name ?? null,
    projectStatus: project?.status ?? null,
    summary,
    sections,
    planFact,
    evidence,
    alertFeed,
    systemPrompt,
  };
}

export function buildAIChatMessages(
  messages: AIChatMessage[],
  bundle: AIChatContextBundle
): AIChatMessage[] {
  const normalizedMessages = messages
    .map(normalizeMessage)
    .filter((message): message is AIChatMessage => message !== null);
  const existingSystemMessages = normalizedMessages.filter((message) => message.role === "system");
  const nonSystemMessages = normalizedMessages.filter((message) => message.role !== "system");

  return [
    { role: "system", content: bundle.systemPrompt },
    ...existingSystemMessages,
    ...nonSystemMessages,
  ];
}

export function buildSystemPrompt(input: {
  focus: AIChatFocus;
  locale: BriefLocale;
  sections: AIChatContextSection[];
  summary: string;
  scope: "portfolio" | "project";
}) {
  const focusNote = buildFocusNote(input.focus, input.locale, input.scope);
  const sectionText = input.sections
    .map((section) => {
      const bullets = section.bullets
        .filter((bullet) => bullet.trim().length > 0)
        .map((bullet) => `- ${bullet}`)
        .join("\n");

      return `### ${section.title}\n${bullets}`;
    })
    .join("\n\n");

  return [
    "Ты CEOClaw AI — ассистент для проектных менеджеров, руководителей и PMO.",
    "Отвечай кратко, по делу и на языке пользователя.",
    "Используй только факты из контекста ниже. Если данных недостаточно, честно скажи об этом.",
    "Не придумывай новые цифры, факты или причины.",
    "Если вопрос про бюджет, обязательно используй budgetPlan, budgetFact, variance, CPI, SPI, EAC и VAC, если они есть.",
    "Если вопрос про риски, называй severity, owner, mitigation и ближайшее действие.",
    "Если вопрос про исполнение, упоминай overdue tasks, blocked tasks, milestones и work reports.",
    "Если вопрос про evidence, перечисляй записи, sourceType, confidence и verificationStatus.",
    "Структура ответа:",
    "1. Короткий ответ",
    "2. Факты",
    "3. Рекомендация",
    "4. Если нужно — следующий шаг",
    "",
    `Сводка: ${input.summary}`,
    `Фокус: ${focusNote}`,
    "",
    "Контекст:",
    sectionText,
  ].join("\n");
}

export function detectAIChatFocus(message: string): AIChatFocus {
  const text = normalizeText(message);

  if (/(budget|budgetplan|budgetfact|cpi|spi|evm|eac|vac|cost|finance|финанс|бюджет|смет|план-факт|план факт|стоимост|оплат|перерасход)/i.test(text)) {
    return "financial";
  }

  if (/(risk|risks|risky|риск|опасн|угроз|проблем|blocker|blockers|severity|probability|impact|mitigation)/i.test(text)) {
    return "risk";
  }

  if (/(task|tasks|задач|deadline|due date|срок|schedule|progress|просроч|blocked|milestone|milestones|исполнен)/i.test(text)) {
    return "execution";
  }

  if (/(team|resource|resources|capacity|allocated|load|команд|люд|перегруз)/i.test(text)) {
    return "team";
  }

  if (/(report|reports|brief|status|summary|отч[её]т|сводк|digest|update)/i.test(text)) {
    return "reporting";
  }

  if (/(evidence|fact|facts|source|sources|доказ|источник|вериф|confidence|верифиц)/i.test(text)) {
    return "evidence";
  }

  return "general";
}

export function extractLatestUserMessage(messages: AIChatMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user");
  const candidate = userMessages.at(-1) ?? messages.at(-1);
  return candidate?.content.trim() ?? "";
}

function buildSections(input: {
  alertFeed: AlertFeed;
  evidence: EvidenceListResult;
  focus: AIChatFocus;
  locale: BriefLocale;
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  project: ExecutiveProject | null;
  scope: "portfolio" | "project";
  snapshot: ExecutiveSnapshot;
}): AIChatContextSection[] {
  const sections: AIChatContextSection[] = [];

  sections.push(buildContextSection(input));
  sections.push(buildFocusSection(input.focus, input.locale));
  sections.push(buildPlanFactSection(input));
  sections.push(buildAlertsSection(input.alertFeed, input.locale));
  sections.push(buildEvidenceSection(input.evidence, input.locale, input.scope, input.project));
  sections.push(buildTeamSection(input.snapshot, input.project, input.scope, input.locale));

  return sections.filter((section) => section.bullets.length > 0);
}

function buildContextSection(input: {
  alertFeed: AlertFeed;
  evidence: EvidenceListResult;
  focus: AIChatFocus;
  locale: BriefLocale;
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  project: ExecutiveProject | null;
  scope: "portfolio" | "project";
  snapshot: ExecutiveSnapshot;
}): AIChatContextSection {
  if (input.scope === "project" && input.project) {
    const projectPlanFact = input.planFact as ProjectPlanFactSummary;

    return {
      title: "Контекст проекта",
      bullets: [
        `Проект «${input.project.name}» — ${formatProjectStatus(input.project.status, input.locale)}, здоровье ${input.project.health}/100, прогресс ${input.project.progress.toFixed(1)}%.`,
        `Срок: ${formatShortDate(input.project.dates.end, input.locale)}; ближайший milestone: ${input.project.nextMilestone ? `${input.project.nextMilestone.name} (${formatShortDate(input.project.nextMilestone.date, input.locale)})` : "нет данных"}.`,
        `Бюджет: plan ${formatCurrency(input.project.budget.planned, input.project.budget.currency, input.locale)}, fact ${formatCurrency(input.project.budget.actual, input.project.budget.currency, input.locale)}, variance ${formatCurrency(projectPlanFact.budgetVariance, input.project.budget.currency, input.locale)}.`,
      ],
    };
  }

  const portfolioPlanFact = input.planFact as PortfolioPlanFactSummary;
  const topProjectNames = input.alertFeed.alerts
    .map((alert) => alert.projectName)
    .filter((projectName): projectName is string => Boolean(projectName))
    .slice(0, SECTION_LIMITS.projects);

  return {
    title: "Контекст портфеля",
    bullets: [
      `Портфель: ${portfolioPlanFact.totals.projectCount} ${formatProjectNoun(portfolioPlanFact.totals.projectCount, input.locale)}, ${portfolioPlanFact.totals.criticalProjects} critical сигналов и ${portfolioPlanFact.totals.projectsOverBudget} проектов с перерасходом.`,
      `Execution: ${portfolioPlanFact.totals.projectsBehindPlan} ${formatProjectNoun(portfolioPlanFact.totals.projectsBehindPlan, input.locale)} behind plan, ${portfolioPlanFact.totals.staleFieldReportingProjects} stale reporting projects, ${portfolioPlanFact.totals.pendingReviewProjects} pending review queues.`,
      topProjectNames.length > 0
        ? `Главные точки внимания: ${formatList(topProjectNames, input.locale)}.`
        : "Явных лидеров по эскалации сейчас нет.",
    ],
  };
}

function buildFocusSection(focus: AIChatFocus, locale: BriefLocale): AIChatContextSection {
  const bulletsByFocus: Record<AIChatFocus, string[]> = {
    general: [
      locale === "ru"
        ? "Сначала дай короткий ответ, затем 3-5 фактов и только потом рекомендацию."
        : "Start with a short answer, then 3-5 facts, then a recommendation.",
    ],
    financial: [
      locale === "ru"
        ? "Сначала анализируй budgetPlan, budgetFact, variance, CPI, SPI, EAC и VAC."
        : "Prioritize budgetPlan, budgetFact, variance, CPI, SPI, EAC, and VAC first.",
    ],
    risk: [
      locale === "ru"
        ? "Сначала анализируй severity, owner, mitigation и next action."
        : "Prioritize severity, owner, mitigation, and the next action first.",
    ],
    execution: [
      locale === "ru"
        ? "Сначала анализируй overdue tasks, blocked tasks, milestones и work reports."
        : "Prioritize overdue tasks, blocked tasks, milestones, and work reports first.",
    ],
    team: [
      locale === "ru"
        ? "Сначала анализируй capacity vs allocated, перегруз и узкие места в команде."
        : "Prioritize capacity vs allocated, overload, and team bottlenecks first.",
    ],
    reporting: [
      locale === "ru"
        ? "Сначала анализируй approved/pending/rejected work reports и свежесть отчётности."
        : "Prioritize approved/pending/rejected work reports and reporting freshness first.",
    ],
    evidence: [
      locale === "ru"
        ? "Сначала анализируй evidence records, sourceType, confidence и verificationStatus."
        : "Prioritize evidence records, sourceType, confidence, and verificationStatus first.",
    ],
  };

  return {
    title: "Фокус ответа",
    bullets: bulletsByFocus[focus],
  };
}

function buildPlanFactSection(input: {
  locale: BriefLocale;
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  project: ExecutiveProject | null;
  scope: "portfolio" | "project";
}): AIChatContextSection {
  if (input.scope === "project" && input.project) {
    const planFact = input.planFact as ProjectPlanFactSummary;

    return {
      title: "План-факт и исполнение",
      bullets: [
        `План по прогрессу: ${planFact.plannedProgress.toFixed(1)}%, факт: ${planFact.actualProgress.toFixed(1)}%, отклонение: ${formatSignedPercent(planFact.progressVarianceRatio, input.locale)}.`,
        `EVM: CPI ${formatNullableMetric(planFact.evm.cpi)}, SPI ${formatNullableMetric(planFact.evm.spi)}, EAC ${formatNullableCurrency(planFact.evm.eac, input.project.budget.currency, input.locale)}, VAC ${formatNullableCurrency(planFact.evm.vac, input.project.budget.currency, input.locale)}.`,
        `Tasks: ${planFact.evidence.completedTasks}/${planFact.evidence.totalTasks} done, ${planFact.evidence.blockedTasks} blocked, ${planFact.evidence.overdueTasks} overdue; work reports: ${planFact.evidence.approvedWorkReports} approved, ${planFact.evidence.pendingWorkReports} pending, ${planFact.evidence.rejectedWorkReports} rejected.`,
        planFact.evidence.daysSinceLastApprovedReport !== null
          ? `Последний approved report был ${planFact.evidence.daysSinceLastApprovedReport} ${input.locale === "ru" ? "дней" : "days"} назад.`
          : "Approved work reports пока нет.",
      ],
    };
  }

  const planFact = input.planFact as PortfolioPlanFactSummary;

  return {
    title: "План-факт портфеля",
    bullets: [
      `Плановый прогресс: ${planFact.totals.plannedProgress.toFixed(1)}%, фактический: ${planFact.totals.actualProgress.toFixed(1)}%, отклонение: ${formatSignedPercent(planFact.totals.progressVariance / 100, input.locale)}.`,
      `Бюджет портфеля: variance ${formatSignedPercent(planFact.totals.budgetVarianceRatio, input.locale)}, CPI ${formatNullableMetric(planFact.totals.cpi)}, SPI ${formatNullableMetric(planFact.totals.spi)}.`,
      `Risk markers: ${planFact.totals.projectsBehindPlan} behind plan, ${planFact.totals.projectsOverBudget} over budget, ${planFact.totals.staleFieldReportingProjects} stale reporting, ${planFact.totals.pendingReviewProjects} pending review.`,
    ],
  };
}

function buildAlertsSection(alertFeed: AlertFeed, locale: BriefLocale): AIChatContextSection {
  if (alertFeed.alerts.length === 0) {
    return {
      title: "Сигналы",
      bullets: [
        locale === "ru"
          ? "Активных сигналов нет — используй базовые факты и не придумывай проблемы."
          : "No active signals right now — rely on the base facts and avoid inventing issues.",
      ],
    };
  }

  return {
    title: "Сигналы",
    bullets: [
      ...alertFeed.alerts.slice(0, SECTION_LIMITS.alerts).map((alert) =>
        `[${alert.severity.toUpperCase()}] ${alert.title} — ${alert.summary} Action: ${alert.recommendedAction}`
      ),
      ...alertFeed.recommendationsSummary.slice(0, 2).map((recommendation) => `Recommendation: ${recommendation}`),
    ],
  };
}

function buildEvidenceSection(
  evidence: EvidenceListResult,
  locale: BriefLocale,
  scope: "portfolio" | "project",
  project: ExecutiveProject | null
): AIChatContextSection {
  const summary = evidence.summary;
  const bullets: string[] = [];

  if (summary.total === 0) {
    bullets.push(
      locale === "ru"
        ? "Evidence ledger пуст — не выдумывай подтверждения, которых нет."
        : "The evidence ledger is empty — do not invent supporting facts that are not there."
    );
    return {
      title: "Evidence",
      bullets,
    };
  }

  bullets.push(
    `Evidence ledger: ${summary.total} records, ${summary.verified} verified, ${summary.observed} observed, ${summary.reported} reported, average confidence ${summary.averageConfidence?.toFixed(2) ?? "n/a"}.`
  );

  if (summary.lastObservedAt) {
    bullets.push(`Last observed at ${formatShortDate(summary.lastObservedAt, locale)}.`);
  }

  const records = scope === "project" && project
    ? evidence.records.filter((record) => record.projectId === project.id || record.projectId === null)
    : evidence.records;

  records.slice(0, SECTION_LIMITS.evidence).forEach((record, index) => {
    bullets.push(
      `${index + 1}. [${record.verificationStatus}] ${record.title} — ${record.summary ?? "no summary"} (confidence ${record.confidence.toFixed(2)})`
    );
  });

  return {
    title: "Evidence",
    bullets,
  };
}

function buildTeamSection(
  snapshot: ExecutiveSnapshot,
  project: ExecutiveProject | null,
  scope: "portfolio" | "project",
  locale: BriefLocale
): AIChatContextSection {
  const members = snapshot.teamMembers;

  if (members.length === 0) {
    return {
      title: "Команда",
      bullets: [
        locale === "ru"
          ? "Команда не загружена — отвечай без предположений о capacity."
          : "No team data is loaded — answer without assuming capacity details.",
      ],
    };
  }

  const projectMembers = scope === "project" && project
    ? members.filter((member) => member.projectIds.includes(project.id))
    : members;
  const relevantMembers = projectMembers.length > 0 ? projectMembers : members;
  const overloadedMembers = relevantMembers
    .filter((member) => member.capacity > 0 && member.allocated / member.capacity >= 0.9)
    .slice(0, SECTION_LIMITS.team);

  return {
    title: "Команда и ресурсы",
    bullets: [
      `Team size: ${relevantMembers.length} members${overloadedMembers.length > 0 ? `, ${overloadedMembers.length} highly loaded` : ""}.`,
      ...overloadedMembers.map(
        (member) =>
          `${member.name}: allocated ${member.allocated}/${member.capacity} (${formatSignedPercent(member.allocated / member.capacity - 1, locale)})`
      ),
    ],
  };
}

function buildSummaryLine(input: {
  alertFeed: AlertFeed;
  locale: BriefLocale;
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  project: ExecutiveProject | null;
  scope: "portfolio" | "project";
}): string {
  if (input.scope === "project" && input.project) {
    const planFact = input.planFact as ProjectPlanFactSummary;

    return [
      `Проект «${input.project.name}»`,
      `${formatProjectStatus(input.project.status, input.locale)}, здоровье ${input.project.health}/100`,
      `progress ${input.project.progress.toFixed(1)}% vs plan ${planFact.plannedProgress.toFixed(1)}%`,
      `budget ${formatCurrency(input.project.budget.actual, input.project.budget.currency, input.locale)} / ${formatCurrency(input.project.budget.planned, input.project.budget.currency, input.locale)}`,
      `variance ${formatSignedPercent(planFact.budgetVarianceRatio, input.locale)}`,
      `CPI ${formatNullableMetric(planFact.evm.cpi)}, SPI ${formatNullableMetric(planFact.evm.spi)}`,
    ].join(" · ");
  }

  const planFact = input.planFact as PortfolioPlanFactSummary;
  const topProjectNames = input.alertFeed.alerts
    .map((alert) => alert.projectName)
    .filter((projectName): projectName is string => Boolean(projectName))
    .slice(0, SECTION_LIMITS.projects);

  return [
    `Портфель: ${planFact.totals.projectCount} ${formatProjectNoun(planFact.totals.projectCount, input.locale)}`,
    `${planFact.totals.criticalProjects} critical signals`,
    `${planFact.totals.projectsOverBudget} over budget`,
    `variance ${formatSignedPercent(planFact.totals.budgetVarianceRatio, input.locale)}`,
    topProjectNames.length > 0 ? `focus ${formatList(topProjectNames, input.locale)}` : "no single focus project",
  ].join(" · ");
}

function buildFocusNote(focus: AIChatFocus, locale: BriefLocale, scope: "portfolio" | "project") {
  const prefix = scope === "project"
    ? locale === "ru"
      ? "Для выбранного проекта"
      : "For the selected project"
    : locale === "ru"
      ? "Для портфеля"
      : "For the portfolio";

  switch (focus) {
    case "financial":
      return `${prefix}: ${locale === "ru" ? "сначала бюджет, план-факт, CPI/SPI, EAC/VAC." : "prioritize budget, plan-vs-fact, CPI/SPI, EAC/VAC first."}`;
    case "risk":
      return `${prefix}: ${locale === "ru" ? "сначала severity, owner, mitigation и next action." : "prioritize severity, owner, mitigation, and the next action first."}`;
    case "execution":
      return `${prefix}: ${locale === "ru" ? "сначала overdue tasks, blocked tasks, milestones и work reports." : "prioritize overdue tasks, blocked tasks, milestones, and work reports first."}`;
    case "team":
      return `${prefix}: ${locale === "ru" ? "сначала capacity vs allocated и перегруз команды." : "prioritize capacity vs allocated and team overload first."}`;
    case "reporting":
      return `${prefix}: ${locale === "ru" ? "сначала свежесть work reports и статусы approvals." : "prioritize work report freshness and approval status first."}`;
    case "evidence":
      return `${prefix}: ${locale === "ru" ? "сначала records, sourceType, confidence и verificationStatus." : "prioritize records, sourceType, confidence, and verificationStatus first."}`;
    case "general":
    default:
      return `${prefix}: ${locale === "ru" ? "сначала короткий ответ, затем факты и рекомендация." : "start with a short answer, then facts and a recommendation."}`;
  }
}

function normalizeMessage(message: AIChatMessage): AIChatMessage | null {
  if (!message || typeof message.content !== "string") {
    return null;
  }

  const content = message.content.trim();
  if (!content) {
    return null;
  }

  return {
    role: message.role,
    content,
  };
}

function detectChatLocale(message: string, requestedLocale?: string): BriefLocale {
  if (requestedLocale === "en") {
    return "en";
  }

  if (/[а-яё]/i.test(message)) {
    return "ru";
  }

  return "en";
}

async function loadSnapshotWithFallback(
  projectId: string | undefined,
  deps: AIChatContextDeps
): Promise<{ snapshot: ExecutiveSnapshot; source: "live" | "mock" }> {
  const filter = projectId ? { projectId } : undefined;
  const loadSnapshot = deps.loadSnapshot ?? loadExecutiveSnapshot;
  const loadMockSnapshot = deps.loadMockSnapshot ?? buildMockExecutiveSnapshot;

  try {
    const snapshot = await loadSnapshot(filter);
    if (process.env.NODE_ENV !== "production" && snapshot.projects.length === 0) {
      logger.warn("[AI Chat] Live snapshot was empty; using mock snapshot fallback.");
      const mockSnapshot = await loadMockSnapshot(filter);
      if (mockSnapshot.projects.length > 0) {
        return { snapshot: mockSnapshot, source: "mock" };
      }
    }

    return { snapshot, source: "live" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[AI Chat] Falling back to mock snapshot: ${errorMessage}`);

    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    const snapshot = await loadMockSnapshot(filter);
    if (snapshot.projects.length === 0 && projectId) {
      throw new Error(`Project "${projectId}" was not found.`);
    }

    return { snapshot, source: "mock" };
  }
}

async function loadEvidenceWithFallback(
  snapshot: ExecutiveSnapshot,
  projectId: string | null,
  focus: AIChatFocus,
  deps: AIChatContextDeps
): Promise<EvidenceListResult> {
  const loadEvidence = deps.loadEvidence ?? getEvidenceLedgerOverview;
  const query: EvidenceQuery = {
    limit: focus === "evidence" ? 8 : 5,
    ...(projectId ? { projectId } : {}),
  };

  try {
    const evidence = await loadEvidence(query);

    if (
      process.env.NODE_ENV !== "production" &&
      evidence.summary.total === 0 &&
      snapshot.workReports.length > 0
    ) {
      logger.warn("[AI Chat] Live evidence ledger was empty; using snapshot-derived evidence.");
      return buildSnapshotEvidenceOverview(snapshot, projectId);
    }

    return evidence;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[AI Chat] Falling back to snapshot-derived evidence: ${errorMessage}`);

    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    return buildSnapshotEvidenceOverview(snapshot, projectId);
  }
}

function buildSnapshotEvidenceOverview(
  snapshot: ExecutiveSnapshot,
  projectId: string | null
): EvidenceListResult {
  const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const selectedWorkReports = snapshot.workReports.filter((report) =>
    projectId ? report.projectId === projectId : true
  );
  const records = selectedWorkReports
    .filter((report) => report.status !== "rejected")
    .map<EvidenceRecordView>((report) => ({
      id: report.id,
      sourceType: `work_report:${report.source}`,
      sourceRef: report.reportNumber,
      entityType: "work_report",
      entityRef: report.id,
      projectId: report.projectId,
      title: `${report.reportNumber} · ${report.status}`,
      summary: buildFallbackEvidenceSummary(report, projectLookup.get(report.projectId) ?? null),
      observedAt: (report.reviewedAt ?? report.submittedAt),
      reportedAt: report.submittedAt,
      confidence: report.status === "approved" ? 0.82 : 0.58,
      verificationStatus: report.status === "approved" ? "verified" : "reported",
      metadata: {
        projectName: projectLookup.get(report.projectId) ?? null,
        reportDate: report.reportDate,
        reportNumber: report.reportNumber,
        reportStatus: report.status,
        source: report.source,
        section: null,
      },
      createdAt: report.submittedAt,
      updatedAt: report.reviewedAt ?? report.submittedAt,
    }));

  return {
    syncedAt: snapshot.generatedAt,
    summary: summarizeEvidenceRecords(records),
    records,
    sync: null,
  };
}

function buildFallbackEvidenceSummary(
  report: ExecutiveWorkReport,
  projectName: string | null
) {
  const bits = [
    report.reportNumber,
    projectName ? `project ${projectName}` : null,
    report.status,
    report.source,
  ].filter((value): value is string => Boolean(value));

  return bits.join(" · ");
}

function inferProjectIdFromMessage(
  projects: ExecutiveProject[],
  message: string
): string | null {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) {
    return null;
  }

  const scoredProjects = projects
    .map((project) => {
      const normalizedName = normalizeText(project.name);
      const normalizedDescription = normalizeText(project.description ?? "");
      const exactMatch = normalizedMessage.includes(normalizedName) ? 3 : 0;
      const nameTokens = tokenize(normalizedName);
      const descriptionTokens = tokenize(normalizedDescription);
      const tokenScore =
        [...nameTokens, ...descriptionTokens].filter((token) => normalizedMessage.includes(token)).length;
      const overlapScore = nameTokens.filter((token) => normalizedMessage.includes(token)).length;

      return {
        project,
        score: exactMatch + tokenScore + overlapScore,
      };
    })
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredProjects[0];
  if (!bestMatch || bestMatch.score < 2) {
    return null;
  }

  return bestMatch.project.id;
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNullableMetric(value: number | null) {
  return value === null ? "n/a" : value.toFixed(2);
}

function formatNullableCurrency(
  value: number | null,
  currency: string,
  locale: BriefLocale
) {
  return value === null ? "n/a" : formatCurrency(value, currency, locale);
}
