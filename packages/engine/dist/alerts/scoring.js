import { buildProjectPlanFactSummary } from '../plan-fact/service';
import { formatCurrency, formatList, formatProjectNoun, formatSignedPercent, formatTaskNoun, resolveBriefLocale, } from '../briefs/locale';
const SEVERITY_SCORES = {
    critical: 100,
    high: 80,
    medium: 60,
    low: 40,
};
export function buildAlertFeed(snapshot, options = {}) {
    var _a, _b;
    const referenceDate = toDate((_a = options.referenceDate) !== null && _a !== void 0 ? _a : snapshot.generatedAt);
    const locale = resolveBriefLocale(options.locale);
    const limit = (_b = options.limit) !== null && _b !== void 0 ? _b : 8;
    const projectAlerts = options.projectId
        ? buildProjectAlerts(snapshot, options.projectId, { locale, referenceDate })
        : snapshot.projects.flatMap((project) => buildProjectAlerts(snapshot, project.id, { locale, referenceDate }));
    const alerts = options.projectId
        ? projectAlerts
        : [...buildPortfolioAlerts(snapshot, { locale, referenceDate }), ...projectAlerts];
    const prioritized = alerts.sort(compareAlerts).slice(0, limit);
    return {
        generatedAt: referenceDate.toISOString(),
        scope: options.projectId ? "project" : "portfolio",
        summary: {
            total: prioritized.length,
            critical: prioritized.filter((alert) => alert.severity === "critical").length,
            high: prioritized.filter((alert) => alert.severity === "high").length,
            medium: prioritized.filter((alert) => alert.severity === "medium").length,
            low: prioritized.filter((alert) => alert.severity === "low").length,
            averageConfidence: average(prioritized.map((alert) => round(alert.confidence, 2))),
            averageFreshness: average(prioritized.map((alert) => round(alert.freshness, 2))),
        },
        alerts: prioritized,
        recommendationsSummary: summarizeRecommendations(prioritized, locale),
    };
}
export function buildPortfolioAlerts(snapshot, options = {}) {
    var _a, _b, _c;
    const referenceDate = toDate((_a = options.referenceDate) !== null && _a !== void 0 ? _a : snapshot.generatedAt);
    const locale = resolveBriefLocale(options.locale);
    const projectAlerts = snapshot.projects.flatMap((project) => buildProjectAlerts(snapshot, project.id, { locale, referenceDate }));
    const atRiskProjects = snapshot.projects.filter((project) => project.status === "at-risk" || project.health < 55);
    const criticalProjectAlerts = projectAlerts.filter((alert) => alert.severity === "critical");
    const overdueTasks = snapshot.tasks.filter((task) => isOpenTask(task) && isPast(task.dueDate, referenceDate));
    const overloadedMembers = snapshot.teamMembers.filter((member) => member.capacity > 0 && member.allocated / member.capacity >= 0.9);
    const totalBudgetVariance = snapshot.projects.reduce((sum, project) => {
        const budgetPlanToDate = calculateBudgetPlanToDate(project, referenceDate);
        return sum + (project.budget.actual - budgetPlanToDate);
    }, 0);
    const totalBudgetPlanToDate = snapshot.projects.reduce((sum, project) => sum + calculateBudgetPlanToDate(project, referenceDate), 0);
    const totalBudgetVarianceRatio = totalBudgetPlanToDate > 0 ? totalBudgetVariance / totalBudgetPlanToDate : 0;
    const alerts = [];
    if (atRiskProjects.length >= Math.max(1, Math.ceil(snapshot.projects.length * 0.3))) {
        const projectNames = atRiskProjects
            .slice(0, 3)
            .map((project) => project.name);
        alerts.push(scoreAlert({
            id: "portfolio-attention",
            scope: "portfolio",
            category: "portfolio",
            severity: atRiskProjects.length >= Math.max(2, Math.ceil(snapshot.projects.length * 0.4))
                ? "critical"
                : "high",
            confidence: 0.9,
            title: locale === "ru"
                ? "Критическая нагрузка сосредоточена в ограниченном наборе проектов"
                : "Attention load is concentrated in a small set of projects",
            summary: locale === "ru"
                ? `${atRiskProjects.length} из ${snapshot.projects.length} ${formatProjectNoun(snapshot.projects.length, locale)} требуют эскалации; лидируют ${formatList(projectNames, locale)}.`
                : `${atRiskProjects.length} of ${snapshot.projects.length} projects currently require escalation, led by ${formatList(projectNames, locale)}.`,
            whyItMatters: locale === "ru"
                ? "Если не принять решения по объёму, владельцам и очередности, управленческое внимание уйдёт в постоянное тушение пожаров."
                : "Management bandwidth is likely to be consumed by firefighting unless decisions are made on scope, ownership, or sequencing.",
            recommendedAction: locale === "ru"
                ? "Провести портфельную эскалацию и назначить ответственного руководителя для самых рискованных проектов."
                : "Run a portfolio escalation review and assign executive owners to the highest-risk projects.",
            detectedAt: (_b = latestTimestamp(atRiskProjects.map((project) => { var _a, _b; return (_b = (_a = project.history.at(-1)) === null || _a === void 0 ? void 0 : _a.date) !== null && _b !== void 0 ? _b : snapshot.generatedAt; }))) !== null && _b !== void 0 ? _b : snapshot.generatedAt,
            metrics: {
                atRiskProjects: atRiskProjects.length,
            },
        }, referenceDate));
    }
    if (overdueTasks.length >= 2) {
        const affectedProjects = new Set(overdueTasks.map((task) => task.projectId)).size;
        alerts.push(scoreAlert({
            id: "portfolio-schedule",
            scope: "portfolio",
            category: "schedule",
            severity: affectedProjects >= 2 || overdueTasks.length >= 4 ? "critical" : "high",
            confidence: 0.92,
            title: locale === "ru"
                ? "Сдвиг сроков уже виден на уровне портфеля"
                : "Schedule drift is visible across the portfolio",
            summary: locale === "ru"
                ? `${overdueTasks.length} ${formatTaskNoun(overdueTasks.length, locale, "overdue")} распределены по ${affectedProjects} ${formatProjectNoun(affectedProjects, locale)}.`
                : `${overdueTasks.length} open overdue tasks are spread across ${affectedProjects} projects.`,
            whyItMatters: locale === "ru"
                ? "Просадка по срокам перестала быть локальной проблемой и повышает риск конфликтов за общие ресурсы и обязательства перед стейкхолдерами."
                : "Delivery slippage is no longer isolated, which increases the risk of collisions on shared teams and stakeholder commitments.",
            recommendedAction: locale === "ru"
                ? "Разобрать очередь просрочек, назначить ответственных за восстановление и защитить критический путь на ближайшие две недели."
                : "Review the overdue queue, confirm recovery owners, and protect the critical path for the next two weeks.",
            detectedAt: (_c = latestTimestamp(overdueTasks.map((task) => task.dueDate).filter(isNonEmptyString))) !== null && _c !== void 0 ? _c : snapshot.generatedAt,
            metrics: {
                overdueTasks: overdueTasks.length,
                affectedProjects,
            },
        }, referenceDate));
    }
    if (totalBudgetVarianceRatio >= 0.08) {
        alerts.push(scoreAlert({
            id: "portfolio-budget",
            scope: "portfolio",
            category: "budget",
            severity: totalBudgetVarianceRatio >= 0.15 ? "critical" : "high",
            confidence: 0.86,
            title: locale === "ru"
                ? "Затраты портфеля опережают план"
                : "Portfolio spend is running ahead of plan",
            summary: locale === "ru"
                ? `Портфель идёт с отклонением ${formatSignedPercent(totalBudgetVarianceRatio, locale)} к плану на текущую дату.`
                : `Portfolio spend is ${formatSignedPercent(totalBudgetVarianceRatio, locale)} versus planned-to-date.`,
            whyItMatters: locale === "ru"
                ? "Давление на бюджет портфеля снижает гибкость для финансирования восстановительных действий в проектах, которые уже требуют эскалации."
                : "Budget pressure at portfolio level reduces flexibility to cover recovery actions in the projects that already require escalation.",
            recommendedAction: locale === "ru"
                ? "Заморозить необязательные расходы и решить, финансируются ли восстановительные действия централизованно или внутри каждого проекта."
                : "Freeze non-essential spend and validate whether recovery actions should be funded centrally or inside each project.",
            detectedAt: snapshot.generatedAt,
            metrics: {
                budgetVariance: round(totalBudgetVariance, 0),
            },
        }, referenceDate));
    }
    if (overloadedMembers.length >= 2) {
        alerts.push(scoreAlert({
            id: "portfolio-resource",
            scope: "portfolio",
            category: "resource",
            severity: overloadedMembers.length >= 3 ? "high" : "medium",
            confidence: 0.74,
            title: locale === "ru"
                ? "Ключевые сотрудники работают на пределе"
                : "Key contributors are operating at saturation",
            summary: locale === "ru"
                ? `${overloadedMembers.length} сотрудников загружены более чем на 90%.`
                : `${overloadedMembers.length} team members are above 90% allocation.`,
            whyItMatters: locale === "ru"
                ? "Перегруженные общие ресурсы быстрее всего превращают локальные проблемы отдельных проектов в системный срыв исполнения."
                : "Overloaded shared contributors are the fastest path from isolated project issues to systemic delivery failure.",
            recommendedAction: locale === "ru"
                ? "Перераспределить кросс-проектные назначения и защитить ёмкость под приоритетные восстановительные действия."
                : "Rebalance cross-project assignments and protect capacity for the top-priority recovery work.",
            detectedAt: snapshot.generatedAt,
            metrics: {
                overloadedMembers: overloadedMembers.length,
            },
        }, referenceDate));
    }
    if (!alerts.length && criticalProjectAlerts.length > 0) {
        const leadAlert = criticalProjectAlerts[0];
        alerts.push(scoreAlert({
            id: "portfolio-critical-project",
            scope: "portfolio",
            category: "portfolio",
            severity: "high",
            confidence: 0.7,
            title: locale === "ru"
                ? "Один проект потребляет основное внимание руководства"
                : "One project is driving most of the executive attention",
            summary: locale === "ru"
                ? `${leadAlert.projectName} сейчас даёт основной объём критических сигналов в портфеле.`
                : `${leadAlert.projectName} is the main source of critical alerts in the portfolio.`,
            whyItMatters: locale === "ru"
                ? "Сконцентрированную проблему проще локализовать рано, но без сдерживания она всё равно исказит результат по всему портфелю."
                : "A concentrated issue is easier to resolve early, but it can still distort portfolio outcomes if it is not contained.",
            recommendedAction: locale === "ru"
                ? "Держать самый рискованный проект в листе наблюдения руководства, пока не закрыты два главных сигнала."
                : "Treat the highest-risk project as an executive watch item until its top two alerts are closed.",
            detectedAt: leadAlert.detectedAt,
        }, referenceDate));
    }
    return alerts.sort(compareAlerts);
}
export function buildProjectAlerts(snapshot, projectId, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const referenceDate = toDate((_a = options.referenceDate) !== null && _a !== void 0 ? _a : snapshot.generatedAt);
    const locale = resolveBriefLocale(options.locale);
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
        return [];
    }
    const context = buildProjectSignalContext(snapshot, project, referenceDate);
    const alerts = [];
    if (project.progress < 100 &&
        (context.daysToDeadline < 0 ||
            context.overdueTasks.length > 0 ||
            context.blockedTasks.length >= 2 ||
            context.planFact.progressVariance <= -10)) {
        const criticalOverdue = context.overdueTasks.filter((task) => ["critical", "high"].includes(task.priority)).length;
        alerts.push(scoreAlert({
            id: `${project.id}-schedule`,
            scope: "project",
            category: "schedule",
            severity: context.daysToDeadline < 0 || criticalOverdue > 0
                ? "critical"
                : context.overdueTasks.length >= 2 ||
                    (context.planFact.evm.spi !== null && context.planFact.evm.spi < 0.85)
                    ? "high"
                    : "medium",
            confidence: context.overdueTasks.length > 0 || context.daysToDeadline < 0
                ? 0.96
                : Math.max(0.78, context.planFact.confidence),
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Исполнение отстаёт от подтверждённого плана"
                : "Execution is behind the committed plan",
            summary: buildScheduleSummary(context, locale),
            whyItMatters: locale === "ru"
                ? "Если ближайшее окно поставки не пересобрать явно, сжатие графика начнёт съедать бюджет и управленческое внимание."
                : "Schedule compression will consume budget and management attention if the next delivery window is not explicitly re-sequenced.",
            recommendedAction: locale === "ru"
                ? "Назначить единого ответственного за восстановление, разблокировать задачи и пересобрать ближайшие две недели работ."
                : "Assign a single recovery owner, clear blocked tasks, and rebaseline the next two weeks of work.",
            detectedAt: (_b = (context.overdueTasks.length > 0
                ? latestTimestamp(context.overdueTasks.map((task) => task.dueDate))
                : context.daysToDeadline < 0
                    ? project.dates.end
                    : latestTimestamp(context.blockedTasks.map((task) => task.dueDate)))) !== null && _b !== void 0 ? _b : snapshot.generatedAt,
            metrics: {
                overdueTasks: context.overdueTasks.length,
                blockedTasks: context.blockedTasks.length,
            },
        }, referenceDate));
    }
    if (context.budgetVarianceRatio >= 0.1) {
        alerts.push(scoreAlert({
            id: `${project.id}-budget`,
            scope: "project",
            category: "budget",
            severity: context.budgetVarianceRatio >= 0.2 ||
                project.budget.actual > project.budget.planned ||
                (context.planFact.evm.cpi !== null && context.planFact.evm.cpi < 0.8)
                ? "critical"
                : "high",
            confidence: project.history.length > 0 ? Math.max(0.9, context.planFact.confidence) : 0.76,
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Темп расходования бюджета опережает фактический прогресс"
                : "Cost burn is ahead of the earned progress",
            summary: locale === "ru"
                ? `${project.name} идёт с отклонением ${formatSignedPercent(context.budgetVarianceRatio, locale)} к плану на текущую дату (${formatCurrency(context.budgetVariance, project.budget.currency, locale)}).`
                : `${project.name} is ${formatSignedPercent(context.budgetVarianceRatio, locale)} versus planned-to-date (${formatCurrency(context.budgetVariance, project.budget.currency, locale)}).`,
            whyItMatters: locale === "ru"
                ? "Когда проект тратит быстрее, чем создаёт результат, финансировать восстановительные действия становится всё сложнее."
                : "Recovery actions become harder to fund once the project is spending faster than it is producing deliverables.",
            recommendedAction: locale === "ru"
                ? "Заморозить необязательные расходы и проверить, помещается ли текущий объём работ в утверждённый бюджет."
                : "Freeze non-essential spend and confirm whether the current scope still fits the approved budget.",
            detectedAt: (_c = latestProjectTimestamp(project)) !== null && _c !== void 0 ? _c : snapshot.generatedAt,
            metrics: {
                budgetVariance: round(context.budgetVariance, 0),
            },
        }, referenceDate));
    }
    if (context.openRisks.length > 0 &&
        (context.criticalOpenRisks.length > 0 || calculateRiskExposure(context.openRisks) >= 1.4)) {
        alerts.push(scoreAlert({
            id: `${project.id}-risk`,
            scope: "project",
            category: "risk",
            severity: context.criticalOpenRisks.length > 0
                ? "critical"
                : context.openRisks.length >= 3
                    ? "high"
                    : "medium",
            confidence: Math.min(0.95, 0.62 + context.openRisks.length * 0.08),
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Открытая риск-экспозиция остаётся без закрытия"
                : "Open risk exposure remains unresolved",
            summary: locale === "ru"
                ? `Активны ${context.openRisks.length} ${formatRiskCount(context.openRisks.length, locale)}, из них ${context.criticalOpenRisks.length} высокого уровня.`
                : `${context.openRisks.length} open risks are still active, including ${context.criticalOpenRisks.length} high-severity items.`,
            whyItMatters: locale === "ru"
                ? "Когда давление по срокам уже есть, неотработанные риски быстро превращаются в срыв поставки или перерасход."
                : "Unmitigated risk exposure converts quickly into delivery or cost variance when schedule pressure is already present.",
            recommendedAction: locale === "ru"
                ? "Проверить план снижения риска вместе с владельцами рисков и на этой неделе эскалировать неразрешённые пункты с высоким влиянием."
                : "Review mitigations with risk owners and escalate unresolved items with high impact this week.",
            detectedAt: (_d = latestTimestamp(context.openRisks.map((risk) => risk.updatedAt))) !== null && _d !== void 0 ? _d : snapshot.generatedAt,
            metrics: {
                openRisks: context.openRisks.length,
            },
        }, referenceDate));
    }
    if (context.overloadedTeamMembers.length > 0 ||
        (context.teamMembers.length > 0 &&
            context.openTasks.length > context.teamMembers.length * 2 + 1)) {
        alerts.push(scoreAlert({
            id: `${project.id}-resource`,
            scope: "project",
            category: "resource",
            severity: context.overloadedTeamMembers.length >= 2 ||
                context.openTasks.length > context.teamMembers.length * 3
                ? "high"
                : "medium",
            confidence: context.overloadedTeamMembers.length > 0 ? 0.78 : 0.68,
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Доступная производственная ёмкость на пределе"
                : "Available delivery capacity is tight",
            summary: buildResourceSummary(context, locale),
            whyItMatters: locale === "ru"
                ? "При плотной ёмкости даже небольшой блокер выбивает работу с критического пути и замедляет восстановление."
                : "Tight capacity means even minor blockers will push work off the critical path and slow recovery.",
            recommendedAction: locale === "ru"
                ? "Перераспределить назначения и зарезервировать ёмкость под задачи, которые напрямую защищают ближайшую контрольную точку."
                : "Rebalance assignments and reserve capacity for the tasks that directly protect the next milestone.",
            detectedAt: (_e = latestTimestamp(context.tasks.map((task) => task.dueDate).filter(isNonEmptyString))) !== null && _e !== void 0 ? _e : snapshot.generatedAt,
            metrics: {
                overloadedMembers: context.overloadedTeamMembers.length,
                openTasks: context.openTasks.length,
            },
        }, referenceDate));
    }
    if (context.milestone &&
        context.daysToMilestone !== null &&
        context.daysToMilestone <= 14 &&
        context.planFact.actualProgress + 10 < context.expectedProgress) {
        alerts.push(scoreAlert({
            id: `${project.id}-delivery`,
            scope: "project",
            category: "delivery",
            severity: context.daysToMilestone <= 7 ? "high" : "medium",
            confidence: 0.72,
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Ближайшая контрольная точка находится под угрозой"
                : "The next milestone is exposed",
            summary: locale === "ru"
                ? `${context.milestone.title} должен быть достигнут через ${context.daysToMilestone} дн., при этом прогресс проекта ${project.progress}%.`
                : `${context.milestone.title} is due in ${context.daysToMilestone} days while project progress is ${project.progress}%.`,
            whyItMatters: locale === "ru"
                ? "Если ближайшая контрольная точка сдвинется, доверие стейкхолдеров упадёт, а окно на восстановление резко сузится."
                : "If the next milestone slips, stakeholder confidence drops and the recovery window narrows immediately.",
            recommendedAction: locale === "ru"
                ? "Подтвердить критерии выхода по контрольной точке и убрать или перенести работу, которая не защищает ближайшее обязательство."
                : "Confirm milestone exit criteria and cut or defer work that does not protect the next commitment.",
            detectedAt: context.milestone.date,
            metrics: {
                daysToMilestone: context.daysToMilestone,
            },
        }, referenceDate));
    }
    if (context.planFact.evidence.pendingWorkReports >= 2 ||
        (context.planFact.evidence.daysSinceLastApprovedReport !== null &&
            context.planFact.evidence.daysSinceLastApprovedReport >= 3)) {
        alerts.push(scoreAlert({
            id: `${project.id}-field-evidence`,
            scope: "project",
            category: "delivery",
            severity: context.planFact.evidence.pendingWorkReports >= 4 ||
                ((_f = context.planFact.evidence.daysSinceLastApprovedReport) !== null && _f !== void 0 ? _f : 0) >= 5
                ? "high"
                : "medium",
            confidence: Math.max(0.68, context.planFact.confidence),
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Полевые факты перестают поддерживать управленческий контур"
                : "Field evidence is no longer supporting the operating loop",
            summary: locale === "ru"
                ? `${context.planFact.evidence.pendingWorkReports} отчётов ждут review, последняя подтверждённая запись была ${(_g = context.planFact.evidence.daysSinceLastApprovedReport) !== null && _g !== void 0 ? _g : "давно"} дн. назад.`
                : `${context.planFact.evidence.pendingWorkReports} work reports are pending review and the last approved report was ${(_h = context.planFact.evidence.daysSinceLastApprovedReport) !== null && _h !== void 0 ? _h : "too many"} days ago.`,
            whyItMatters: locale === "ru"
                ? "Когда полевые факты стареют, руководству приходится принимать решения по плану без свежего подтверждения реального состояния работ."
                : "Once field evidence goes stale, management ends up making schedule decisions without fresh confirmation of actual site conditions.",
            recommendedAction: locale === "ru"
                ? "Закрыть backlog review и вернуть ежедневный ритм подтверждения полевых отчётов по проекту."
                : "Clear the review backlog and restore the daily cadence of approved field reports for this project.",
            detectedAt: (_j = context.planFact.evidence.lastApprovedWorkReportDate) !== null && _j !== void 0 ? _j : snapshot.generatedAt,
            metrics: {
                pendingWorkReports: context.planFact.evidence.pendingWorkReports,
                daysSinceLastApprovedReport: (_k = context.planFact.evidence.daysSinceLastApprovedReport) !== null && _k !== void 0 ? _k : 0,
            },
        }, referenceDate));
    }
    if (!alerts.length &&
        (project.status === "at-risk" || project.health < 55 || project.priority === "critical")) {
        alerts.push(scoreAlert({
            id: `${project.id}-watch`,
            scope: "project",
            category: "portfolio",
            severity: "medium",
            confidence: 0.6,
            projectId: project.id,
            projectName: project.name,
            title: locale === "ru"
                ? "Проект остаётся в листе наблюдения руководства"
                : "Project remains on the executive watchlist",
            summary: locale === "ru"
                ? `${project.name} всё ещё отмечен как объект наблюдения, хотя один доминирующий показатель пока не выделяется.`
                : `${project.name} is still flagged as a watch item even though no single metric dominates yet.`,
            whyItMatters: locale === "ru"
                ? "Слабый, но устойчивый сигнал обычно означает, что проекту нужно управленческое решение, а не ещё один отчёт."
                : "A weak but persistent signal usually means the project needs a decision rather than more reporting.",
            recommendedAction: locale === "ru"
                ? "Запросить у ответственного короткий статус с одним конкретным запросом на решение до следующего цикла обзора."
                : "Ask for a concise owner update with one decision request before the next review cycle.",
            detectedAt: (_l = latestProjectTimestamp(project)) !== null && _l !== void 0 ? _l : snapshot.generatedAt,
        }, referenceDate));
    }
    return alerts.sort(compareAlerts);
}
export function scoreAlert(draft, referenceDate = new Date()) {
    const freshness = calculateFreshness(draft.detectedAt, referenceDate);
    const score = SEVERITY_SCORES[draft.severity] * 0.55 +
        clamp(draft.confidence, 0, 1) * 100 * 0.3 +
        freshness * 100 * 0.15;
    return Object.assign(Object.assign({}, draft), { confidence: round(clamp(draft.confidence, 0, 1), 2), freshness, score: round(score, 1) });
}
export function calculateFreshness(detectedAt, referenceDate = new Date()) {
    const reference = toDate(referenceDate).getTime();
    const signalTime = new Date(detectedAt).getTime();
    if (!Number.isFinite(signalTime)) {
        return 0.5;
    }
    if (signalTime >= reference) {
        return 1;
    }
    const ageHours = (reference - signalTime) / (1000 * 60 * 60);
    return round(clamp(1 - ageHours / (24 * 21), 0.25, 1), 2);
}
export function summarizeRecommendations(alerts, locale = "ru", limit = 3) {
    const grouped = new Map();
    const orderedActions = [];
    const recommendations = [];
    for (const alert of alerts) {
        if (!grouped.has(alert.recommendedAction)) {
            grouped.set(alert.recommendedAction, {
                projectNames: [],
                scope: alert.scope,
            });
            orderedActions.push(alert.recommendedAction);
        }
        if (alert.scope === "project" && alert.projectName) {
            const current = grouped.get(alert.recommendedAction);
            if (!current.projectNames.includes(alert.projectName)) {
                current.projectNames.push(alert.projectName);
            }
        }
    }
    for (const action of orderedActions) {
        const current = grouped.get(action);
        if (!current) {
            continue;
        }
        if (current.scope === "project" && current.projectNames.length > 0) {
            const prefix = locale === "ru"
                ? current.projectNames.join(", ")
                : current.projectNames.join(", ");
            recommendations.push(`${prefix}: ${action}`);
        }
        else {
            recommendations.push(action);
        }
        if (recommendations.length >= limit) {
            break;
        }
    }
    return recommendations;
}
function buildProjectSignalContext(snapshot, project, referenceDate) {
    var _a;
    const tasks = snapshot.tasks.filter((task) => task.projectId === project.id);
    const openTasks = tasks.filter(isOpenTask);
    const overdueTasks = openTasks.filter((task) => isPast(task.dueDate, referenceDate));
    const blockedTasks = tasks.filter((task) => task.status === "blocked");
    const risks = snapshot.risks.filter((risk) => risk.projectId === project.id);
    const openRisks = risks.filter((risk) => risk.status === "open");
    const criticalOpenRisks = openRisks.filter((risk) => risk.severity >= 4 || risk.probability * risk.impact >= 0.5);
    const teamMembers = snapshot.teamMembers.filter((member) => member.projectIds.includes(project.id));
    const overloadedTeamMembers = teamMembers.filter((member) => member.capacity > 0 && member.allocated / member.capacity >= 0.9);
    const milestone = (_a = snapshot.milestones
        .filter((candidate) => candidate.projectId === project.id && candidate.status !== "completed")
        .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0]) !== null && _a !== void 0 ? _a : null;
    const daysToDeadline = diffInDays(referenceDate, project.dates.end);
    const daysToMilestone = milestone ? diffInDays(referenceDate, milestone.date) : null;
    const expectedProgress = calculateExpectedProgress(project, referenceDate);
    const budgetPlanToDate = calculateBudgetPlanToDate(project, referenceDate);
    const budgetVariance = project.budget.actual - budgetPlanToDate;
    const budgetVarianceRatio = budgetPlanToDate > 0 ? budgetVariance / budgetPlanToDate : 0;
    const planFact = buildProjectPlanFactSummary(snapshot, project.id, {
        referenceDate,
    });
    return {
        project,
        tasks,
        openTasks,
        overdueTasks,
        blockedTasks,
        risks,
        openRisks,
        criticalOpenRisks,
        teamMembers,
        overloadedTeamMembers,
        milestone,
        daysToDeadline,
        daysToMilestone,
        expectedProgress,
        budgetVariance,
        budgetVarianceRatio,
        planFact,
    };
}
function calculateExpectedProgress(project, referenceDate) {
    const start = new Date(project.dates.start).getTime();
    const end = new Date(project.dates.end).getTime();
    const reference = referenceDate.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return project.progress;
    }
    const elapsedRatio = clamp((reference - start) / (end - start), 0, 1);
    return round(elapsedRatio * 100, 0);
}
function calculateBudgetPlanToDate(project, referenceDate) {
    const datedHistory = [...project.history]
        .filter((point) => new Date(point.date).getTime() <= referenceDate.getTime())
        .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
    if (datedHistory.length > 0) {
        return datedHistory[datedHistory.length - 1].budgetPlanned;
    }
    const start = new Date(project.dates.start).getTime();
    const end = new Date(project.dates.end).getTime();
    const reference = referenceDate.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return project.budget.planned * clamp(project.progress / 100, 0, 1);
    }
    return project.budget.planned * clamp((reference - start) / (end - start), 0, 1);
}
function calculateRiskExposure(risks) {
    return risks.reduce((sum, risk) => sum + risk.probability * risk.impact * (risk.severity / 5), 0);
}
function buildScheduleSummary(context, locale) {
    if (context.daysToDeadline < 0) {
        return locale === "ru"
            ? `${context.project.name} уже вышел за плановую дату завершения; открыты ${context.overdueTasks.length} ${formatTaskNoun(context.overdueTasks.length, locale, "overdue")}.`
            : `${context.project.name} is past its planned finish date with ${context.overdueTasks.length} overdue tasks still open.`;
    }
    if (context.overdueTasks.length > 0) {
        return locale === "ru"
            ? `${context.overdueTasks.length} ${formatTaskNoun(context.overdueTasks.length, locale, "overdue")} и ${context.blockedTasks.length} ${formatTaskNoun(context.blockedTasks.length, locale, "blocked")} замедляют исполнение в ${context.project.name}.`
            : `${context.overdueTasks.length} overdue tasks and ${context.blockedTasks.length} blocked tasks are slowing delivery in ${context.project.name}.`;
    }
    return locale === "ru"
        ? `${context.blockedTasks.length} ${formatTaskNoun(context.blockedTasks.length, locale, "blocked")} ограничивают исполнение в ${context.project.name}.`
        : `${context.blockedTasks.length} blocked tasks are constraining execution in ${context.project.name}.`;
}
function buildResourceSummary(context, locale) {
    if (context.overloadedTeamMembers.length > 0) {
        return locale === "ru"
            ? `${context.overloadedTeamMembers.length} исполнителей уже загружены более чем на 90%, при этом открыты ${context.openTasks.length} ${formatTaskNoun(context.openTasks.length, locale, "open")}.`
            : `${context.overloadedTeamMembers.length} contributors are already above 90% allocation while ${context.openTasks.length} tasks remain open.`;
    }
    return locale === "ru"
        ? `${context.openTasks.length} ${formatTaskNoun(context.openTasks.length, locale, "open")} конкурируют за команду из ${context.teamMembers.length} человек.`
        : `${context.openTasks.length} open tasks are competing for a team of ${context.teamMembers.length} people.`;
}
function latestProjectTimestamp(project) {
    var _a, _b, _c, _d;
    return (_d = (_b = (_a = project.history.at(-1)) === null || _a === void 0 ? void 0 : _a.date) !== null && _b !== void 0 ? _b : (_c = project.nextMilestone) === null || _c === void 0 ? void 0 : _c.date) !== null && _d !== void 0 ? _d : project.dates.start;
}
function latestTimestamp(values) {
    const sorted = values
        .filter(isNonEmptyString)
        .map((value) => new Date(value).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => right - left);
    if (!sorted.length) {
        return null;
    }
    return new Date(sorted[0]).toISOString();
}
function compareAlerts(left, right) {
    return right.score - left.score || right.confidence - left.confidence;
}
function isOpenTask(task) {
    return task.status !== "done" && task.status !== "cancelled";
}
function isPast(value, referenceDate) {
    if (!value) {
        return false;
    }
    return new Date(value).getTime() < referenceDate.getTime();
}
function diffInDays(from, to) {
    const target = new Date(to).getTime();
    return Math.ceil((target - from.getTime()) / (1000 * 60 * 60 * 24));
}
function average(values) {
    if (!values.length) {
        return 0;
    }
    return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function round(value, digits) {
    const multiplier = Math.pow(10, digits);
    return Math.round(value * multiplier) / multiplier;
}
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function formatRiskCount(count, locale) {
    if (locale === "ru") {
        const value = Math.abs(count) % 100;
        const unit = value % 10;
        if (value > 10 && value < 20) {
            return "открытых рисков";
        }
        if (unit > 1 && unit < 5) {
            return "открытых риска";
        }
        if (unit === 1) {
            return "открытый риск";
        }
        return "открытых рисков";
    }
    return count === 1 ? "open risk" : "open risks";
}
