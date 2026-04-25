var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getAgentById } from '../ai/agents.js';
import { loadServerAIContext } from '../ai/server-context.js';
import { createServerAIRun } from '../ai/server-runs.js';
import { buildProjectAlerts } from '../alerts/scoring.js';
import { resolveBriefLocale } from '../briefs/locale.js';
import { loadExecutiveSnapshot } from '../briefs/snapshot.js';
import { buildProjectPlanFactSummary } from '../plan-fact/service.js';
import { getWorkReportById } from "./service.js";
export function createWorkReportSignalPacket(reportId_1) {
    return __awaiter(this, arguments, void 0, function* (reportId, request = {}, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const now = (_a = deps.now) !== null && _a !== void 0 ? _a : (() => new Date());
        const packetIdFactory = (_b = deps.packetIdFactory) !== null && _b !== void 0 ? _b : createPacketId;
        const createRun = (_c = deps.createRun) !== null && _c !== void 0 ? _c : createServerAIRun;
        const loadWorkReport = (_d = deps.loadWorkReport) !== null && _d !== void 0 ? _d : getWorkReportById;
        const loadSnapshot = (_e = deps.loadSnapshot) !== null && _e !== void 0 ? _e : ((input) => loadExecutiveSnapshot(input));
        const loadContext = (_f = deps.loadContext) !== null && _f !== void 0 ? _f : ((input) => loadServerAIContext({
            projectId: input.projectId,
            locale: input.locale,
            interfaceLocale: input.interfaceLocale,
            pathname: `/projects/${input.projectId}`,
            subtitle: input.subtitle,
            title: input.title,
        }));
        const report = yield loadWorkReport(reportId);
        if (!report) {
            throw new Error(`Work report "${reportId}" was not found.`);
        }
        if (report.status !== "approved") {
            throw new Error("Only approved work reports can be converted into action packets.");
        }
        const [snapshot, context] = yield Promise.all([
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
        const signal = buildSignalSnapshot(report, snapshot, planFact, (_g = request.locale) !== null && _g !== void 0 ? _g : context.locale);
        const blueprints = buildWorkReportSignalRunBlueprints(context, report, signal, request.locale, {
            packetId,
        });
        const runs = yield Promise.all(blueprints.map((blueprint) => __awaiter(this, void 0, void 0, function* () {
            return ({
                purpose: blueprint.purpose,
                label: blueprint.label,
                pollPath: "/api/ai/runs",
                run: yield createRun(blueprint.input),
            });
        })));
        return {
            packetId,
            createdAt: now().toISOString(),
            reportId: report.id,
            reportNumber: report.reportNumber,
            reportStatus: report.status,
            projectId: report.projectId,
            projectName: report.project.name,
            signal,
            runs: runs.map((entry) => (Object.assign(Object.assign({}, entry), { pollPath: `/api/ai/runs/${entry.run.id}` }))),
        };
    });
}
export function buildWorkReportSignalRunBlueprints(context, report, signal, locale = context.locale, traceMeta) {
    var _a, _b, _c, _d, _e;
    const planner = requireAgent("execution-planner");
    const riskResearcher = requireAgent("risk-researcher");
    const statusReporter = requireAgent("status-reporter");
    const projectName = (_b = (_a = context.project) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : context.activeContext.title;
    const topAlertLines = signal.topAlerts.length > 0
        ? signal.topAlerts
            .map((alert, index) => `${index + 1}. [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.summary}`)
            .join("\n")
        : locale === "ru"
            ? "1. Нет активных проектных alerts, но нужно проверить handoff по смене."
            : locale === "zh"
                ? "1. 当前没有激活告警，但仍需检查班次交接。"
                : "1. No active project alerts, but the shift handoff still requires follow-up.";
    const issuesBlock = ((_c = report.issues) === null || _c === void 0 ? void 0 : _c.trim()) || emptyState(locale, "issues");
    const nextDayPlanBlock = ((_d = report.nextDayPlan) === null || _d === void 0 ? void 0 : _d.trim()) || emptyState(locale, "nextDayPlan");
    const weatherBlock = ((_e = report.weather) === null || _e === void 0 ? void 0 : _e.trim()) || emptyState(locale, "weather");
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
function buildSignalSnapshot(report, snapshot, planFact, locale) {
    var _a;
    const topAlerts = buildProjectAlerts(snapshot, report.projectId, {
        locale: resolveBriefLocale(locale),
    }).slice(0, 3);
    const primaryAlert = topAlerts[0];
    return {
        headline: (_a = primaryAlert === null || primaryAlert === void 0 ? void 0 : primaryAlert.title) !== null && _a !== void 0 ? _a : (report.status === "approved"
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
        summary: buildSignalSummary(report, planFact, primaryAlert === null || primaryAlert === void 0 ? void 0 : primaryAlert.summary, locale),
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
function buildSignalSummary(report, planFact, alertSummary, locale) {
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
function createBlueprint(purpose, label, input) {
    return {
        purpose,
        label,
        input,
    };
}
function requireAgent(agentId) {
    const agent = getAgentById(agentId);
    if (!agent) {
        throw new Error(`Agent "${agentId}" was not found.`);
    }
    return agent;
}
function emptyState(locale, kind) {
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
function copy(locale, map) {
    var _a;
    return (_a = map[locale]) !== null && _a !== void 0 ? _a : map.ru;
}
function createPacketId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `work-report-packet-${crypto.randomUUID()}`;
    }
    return `work-report-packet-${Math.random().toString(36).slice(2, 10)}`;
}
