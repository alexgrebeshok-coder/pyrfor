"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePortfolioBrief = generatePortfolioBrief;
exports.generateProjectBrief = generateProjectBrief;
exports.generatePortfolioBriefFromSnapshot = generatePortfolioBriefFromSnapshot;
exports.generateProjectBriefFromSnapshot = generateProjectBriefFromSnapshot;
exports.buildDemoPortfolioBrief = buildDemoPortfolioBrief;
const scoring_1 = require("../alerts/scoring");
const service_1 = require("../plan-fact/service");
const locale_1 = require("./locale");
const snapshot_1 = require("./snapshot");
async function generatePortfolioBrief(options = {}) {
    const snapshot = await (0, snapshot_1.loadExecutiveSnapshot)({
        generatedAt: options.referenceDate,
    });
    return generatePortfolioBriefFromSnapshot(snapshot, options);
}
async function generateProjectBrief(projectId, options = {}) {
    const snapshot = await (0, snapshot_1.loadExecutiveSnapshot)({
        generatedAt: options.referenceDate,
    });
    return generateProjectBriefFromSnapshot(snapshot, projectId, options);
}
function generatePortfolioBriefFromSnapshot(snapshot, options = {}) {
    const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
    const locale = (0, locale_1.resolveBriefLocale)(options.locale);
    const alertFeed = (0, scoring_1.buildAlertFeed)(snapshot, {
        locale,
        referenceDate,
        limit: 6,
    });
    const portfolioPlanFact = (0, service_1.buildPortfolioPlanFactSummary)(snapshot, {
        referenceDate,
    });
    const totalProjects = snapshot.projects.length;
    const activeProjects = snapshot.projects.filter((project) => ["active", "planning", "at-risk", "on-hold"].includes(project.status)).length;
    const completedProjects = snapshot.projects.filter((project) => project.status === "completed" || project.progress >= 100).length;
    const atRiskProjects = snapshot.projects.filter((project) => project.status === "at-risk" || project.health < 55);
    const criticalProjects = new Set(alertFeed.alerts
        .filter((alert) => alert.projectId && alert.severity === "critical")
        .map((alert) => alert.projectId));
    const overdueTasks = snapshot.tasks.filter((task) => task.status !== "done" &&
        task.status !== "cancelled" &&
        task.dueDate &&
        new Date(task.dueDate).getTime() < referenceDate.getTime()).length;
    const averageHealth = average(snapshot.projects.map((project) => project.health));
    const budgetVariance = portfolioPlanFact.totals.budgetVariance;
    const budgetVarianceRatio = portfolioPlanFact.totals.budgetVarianceRatio;
    const leadProjects = rankProjectsByAttention(snapshot, alertFeed.alerts)
        .slice(0, 3)
        .map((project) => project.name);
    const sections = ensureSections({
        whatHappened: [
            locale === "ru"
                ? `В контуре ${totalProjects} ${(0, locale_1.formatProjectNoun)(totalProjects, locale)}; эскалации требуют ${atRiskProjects.length}, завершены ${completedProjects}.`
                : `${totalProjects} projects are in scope; ${atRiskProjects.length} require escalation and ${completedProjects} have already landed.`,
            overdueTasks > 0
                ? locale === "ru"
                    ? `Открыты ${overdueTasks} ${(0, locale_1.formatTaskNoun)(overdueTasks, locale, "overdue")}; основная концентрация в ${(0, locale_1.formatList)(leadProjects, locale)}.`
                    : `${overdueTasks} overdue tasks remain open, with the heaviest concentration in ${(0, locale_1.formatList)(leadProjects, locale)}.`
                : locale === "ru"
                    ? "Критического кластера просроченных задач в портфеле сейчас не видно."
                    : "No overdue task cluster is currently visible in the portfolio.",
            locale === "ru"
                ? `Среднее здоровье портфеля ${averageHealth}/100, отклонение по затратам ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} к плану на текущую дату.`
                : `Portfolio health averages ${averageHealth}/100 and spend is ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} versus planned-to-date.`,
            locale === "ru"
                ? `Plan-vs-fact: SPI ${formatNullableEvmMetric(portfolioPlanFact.totals.spi, locale)}, CPI ${formatNullableEvmMetric(portfolioPlanFact.totals.cpi, locale)}, позади плана ${portfolioPlanFact.totals.projectsBehindPlan}.`
                : `Plan-vs-fact: SPI ${formatNullableEvmMetric(portfolioPlanFact.totals.spi, locale)}, CPI ${formatNullableEvmMetric(portfolioPlanFact.totals.cpi, locale)}, ${portfolioPlanFact.totals.projectsBehindPlan} projects are behind plan.`,
        ],
        whyItMatters: dedupe(alertFeed.alerts.map((alert) => alert.whyItMatters), 3),
        recommendedActions: alertFeed.recommendationsSummary.length > 0
            ? alertFeed.recommendationsSummary
            : [
                locale === "ru"
                    ? "Сохранить текущий ритм управления и наблюдать за новыми отклонениями."
                    : "Maintain the current cadence and monitor for new exceptions.",
            ],
    }, locale);
    const headline = atRiskProjects.length
        ? locale === "ru"
            ? `Основное давление в портфеле сосредоточено в ${atRiskProjects.length} ${(0, locale_1.formatProjectNoun)(atRiskProjects.length, locale)}`
            : `Portfolio pressure is concentrated in ${atRiskProjects.length} project${atRiskProjects.length === 1 ? "" : "s"}`
        : locale === "ru"
            ? "Портфель в целом стабилен, проблемы локализованы"
            : "Portfolio is stable with localized issues only";
    const summary = locale === "ru"
        ? `${activeProjects} активных ${(0, locale_1.formatProjectNoun)(activeProjects, locale)}, ${criticalProjects.size} с критическими сигналами, отклонение бюджета ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)}, ${overdueTasks} ${(0, locale_1.formatTaskNoun)(overdueTasks, locale, "overdue")}.`
        : `${activeProjects} active projects, ${criticalProjects.size} with critical alerts, ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} budget variance, ${overdueTasks} overdue tasks.`;
    const formats = buildFormats(locale === "ru" ? "Портфельный brief" : "Portfolio brief", headline, summary, sections, locale);
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
function generateProjectBriefFromSnapshot(snapshot, projectId, options = {}) {
    const referenceDate = toDate(options.referenceDate ?? snapshot.generatedAt);
    const locale = (0, locale_1.resolveBriefLocale)(options.locale);
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
        throw new Error(`Project "${projectId}" was not found.`);
    }
    const planFact = (0, service_1.buildProjectPlanFactSummary)(snapshot, projectId, {
        referenceDate,
    });
    const alerts = (0, scoring_1.buildProjectAlerts)(snapshot, projectId, {
        locale,
        referenceDate,
    }).slice(0, 5);
    const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);
    const overdueTasks = tasks.filter((task) => task.status !== "done" &&
        task.status !== "cancelled" &&
        task.dueDate &&
        new Date(task.dueDate).getTime() < referenceDate.getTime());
    const openRisks = snapshot.risks.filter((risk) => risk.projectId === projectId && risk.status === "open");
    const budgetVariance = planFact.budgetVariance;
    const budgetVarianceRatio = planFact.budgetVarianceRatio;
    const sections = ensureSections({
        whatHappened: [
            locale === "ru"
                ? `Прогресс проекта ${project.name} составляет ${project.progress}%, при этом открыты ${overdueTasks.length} ${(0, locale_1.formatTaskNoun)(overdueTasks.length, locale, "overdue")} и ${openRisks.length} ${(0, locale_1.formatRiskNoun)(openRisks.length, locale, "open")}.`
                : `${project.name} is ${project.progress}% complete with ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} and ${openRisks.length} open risk${openRisks.length === 1 ? "" : "s"}.`,
            project.nextMilestone
                ? locale === "ru"
                    ? `Следующая контрольная точка: ${project.nextMilestone.name} к ${(0, locale_1.formatShortDate)(project.nextMilestone.date, locale)}`
                    : `Next milestone is ${project.nextMilestone.name} on ${(0, locale_1.formatShortDate)(project.nextMilestone.date, locale)}.`
                : locale === "ru"
                    ? "Для проекта сейчас не зафиксирована активная контрольная точка."
                    : "No active milestone is currently tracked for this project.",
            locale === "ru"
                ? `Отклонение по затратам ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} к плану на текущую дату, индекс здоровья проекта ${project.health}/100.`
                : `Spend is ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} versus planned-to-date and the project health score is ${project.health}/100.`,
            locale === "ru"
                ? `Plan-vs-fact: плановый прогресс ${planFact.plannedProgress}%, фактический ${planFact.actualProgress}%, SPI ${formatNullableEvmMetric(planFact.evm.spi, locale)}, CPI ${formatNullableEvmMetric(planFact.evm.cpi, locale)}.`
                : `Plan-vs-fact: planned progress ${planFact.plannedProgress}%, actual ${planFact.actualProgress}%, SPI ${formatNullableEvmMetric(planFact.evm.spi, locale)}, CPI ${formatNullableEvmMetric(planFact.evm.cpi, locale)}.`,
        ],
        whyItMatters: alerts.length > 0
            ? dedupe(alerts.map((alert) => alert.whyItMatters), 3)
            : [
                locale === "ru"
                    ? "Сейчас нет одного доминирующего сигнала, но проект всё равно требует наблюдения."
                    : "No single signal dominates yet, but the project still requires monitoring.",
            ],
        recommendedActions: alerts.length > 0
            ? dedupe(alerts.map((alert) => alert.recommendedAction), 3)
            : [
                locale === "ru"
                    ? "Сохранить текущий план и наблюдать за отклонением по срокам и затратам."
                    : "Keep the current plan and monitor for schedule or cost drift.",
            ],
    }, locale);
    const headline = alerts[0]?.title ??
        (locale === "ru"
            ? `${project.name} не требует немедленного вмешательства руководства`
            : `${project.name} requires no immediate executive intervention`);
    const summary = locale === "ru"
        ? `Статус ${(0, locale_1.formatProjectStatus)(project.status, locale)}, прогресс ${project.progress}%, ${overdueTasks.length} ${(0, locale_1.formatTaskNoun)(overdueTasks.length, locale, "overdue")}, ${openRisks.length} ${(0, locale_1.formatRiskNoun)(openRisks.length, locale, "open")}, отклонение бюджета ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)}.`
        : `${project.status} status, ${project.progress}% progress, ${overdueTasks.length} overdue tasks, ${openRisks.length} open risks, ${(0, locale_1.formatSignedPercent)(budgetVarianceRatio, locale)} budget variance.`;
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
            planFact: (0, service_1.summarizeProjectPlanFactForBrief)(planFact),
        },
        topAlerts: alerts,
        recommendationsSummary: dedupe(alerts.map((alert) => `${project.name}: ${alert.recommendedAction}`), 3),
        sections,
        formats,
    };
}
async function buildDemoPortfolioBrief(referenceDate) {
    const snapshot = await (0, snapshot_1.buildMockExecutiveSnapshot)({ generatedAt: referenceDate });
    return generatePortfolioBriefFromSnapshot(snapshot, { referenceDate });
}
function rankProjectsByAttention(snapshot, alertIds) {
    const attentionScores = new Map();
    for (const project of snapshot.projects) {
        attentionScores.set(project.id, 0);
    }
    for (const alert of alertIds) {
        if (!alert.projectId)
            continue;
        attentionScores.set(alert.projectId, (attentionScores.get(alert.projectId) ?? 0) + 1);
    }
    return [...snapshot.projects].sort((left, right) => {
        const delta = (attentionScores.get(right.id) ?? 0) - (attentionScores.get(left.id) ?? 0);
        if (delta !== 0) {
            return delta;
        }
        return left.health - right.health;
    });
}
function buildFormats(title, headline, summary, sections, locale) {
    const dashboardHighlights = [
        ...sections.whatHappened.slice(0, 2),
        ...sections.recommendedActions.slice(0, 1),
    ];
    const sectionHeadings = locale === "ru"
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
function ensureSections(sections, locale) {
    return {
        whatHappened: sections.whatHappened.filter(Boolean).length > 0
            ? sections.whatHappened.filter(Boolean)
            : [
                locale === "ru"
                    ? "В последних данных портфеля не обнаружено материальных изменений."
                    : "No material change detected in the latest portfolio data.",
            ],
        whyItMatters: sections.whyItMatters.filter(Boolean).length > 0
            ? sections.whyItMatters.filter(Boolean)
            : [
                locale === "ru"
                    ? "Сейчас не видно существенного управленческого эффекта."
                    : "No significant management impact is visible at the moment.",
            ],
        recommendedActions: sections.recommendedActions.filter(Boolean).length > 0
            ? sections.recommendedActions.filter(Boolean)
            : [
                locale === "ru"
                    ? "Продолжать мониторинг в текущем ритме."
                    : "Continue monitoring with the current cadence.",
            ],
    };
}
function average(values) {
    if (!values.length) {
        return 0;
    }
    return round(values.reduce((sum, value) => sum + value, 0) / values.length, 0);
}
function dedupe(values, limit) {
    const seen = new Set();
    const result = [];
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
function round(value, digits) {
    const multiplier = 10 ** digits;
    return Math.round(value * multiplier) / multiplier;
}
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function formatNullableEvmMetric(value, locale) {
    if (value === null) {
        return locale === "ru" ? "н/д" : "n/a";
    }
    return value.toFixed(2);
}
