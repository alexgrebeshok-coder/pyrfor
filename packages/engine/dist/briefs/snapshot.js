var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
const DEFAULT_CURRENCY = "RUB";
const HEALTH_MAP = {
    good: 82,
    warning: 58,
    critical: 28,
};
const PROBABILITY_MAP = {
    low: 0.3,
    medium: 0.6,
    high: 0.85,
};
const IMPACT_MAP = {
    low: 0.3,
    medium: 0.6,
    high: 0.85,
};
export function loadExecutiveSnapshot() {
    return __awaiter(this, arguments, void 0, function* (filter = {}) {
        return buildLiveExecutiveSnapshot(filter);
    });
}
export function buildMockExecutiveSnapshot() {
    return __awaiter(this, arguments, void 0, function* (filter = {}) {
        const { getMockProjects, getMockRisks, getMockTasks, getMockTeam, } = yield import('../mock-data');
        const generatedAt = normalizeTimestamp(filter.generatedAt);
        const projectId = filter.projectId;
        const projects = getMockProjects()
            .filter((project) => !projectId || project.id === projectId)
            .map((project) => ({
            id: project.id,
            name: project.name,
            description: project.description,
            status: project.status,
            priority: project.priority,
            progress: project.progress,
            health: project.health,
            direction: project.direction,
            location: project.location,
            budget: {
                planned: project.budget.planned,
                actual: project.budget.actual,
                currency: project.budget.currency || DEFAULT_CURRENCY,
            },
            dates: {
                start: project.dates.start,
                end: project.dates.end,
            },
            nextMilestone: project.nextMilestone
                ? {
                    name: project.nextMilestone.name,
                    date: project.nextMilestone.date,
                }
                : null,
            history: project.history.map((point) => ({
                date: point.date,
                progress: point.progress,
                budgetPlanned: point.budgetPlanned,
                budgetActual: point.budgetActual,
            })),
        }));
        const allowedProjectIds = new Set(projects.map((project) => project.id));
        const tasks = getMockTasks()
            .filter((task) => allowedProjectIds.has(task.projectId))
            .map((task) => {
            var _a, _b, _c, _d;
            return ({
                id: task.id,
                projectId: task.projectId,
                title: task.title,
                status: task.status,
                priority: task.priority,
                dueDate: task.dueDate || null,
                createdAt: task.createdAt,
                assigneeId: (_b = (_a = task.assignee) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                assigneeName: (_d = (_c = task.assignee) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                completedAt: task.status === "done" ? task.dueDate : null,
            });
        });
        const risks = getMockRisks()
            .filter((risk) => allowedProjectIds.has(risk.projectId))
            .map((risk) => {
            var _a, _b, _c;
            const project = projects.find((candidate) => candidate.id === risk.projectId);
            const anchor = (_c = (_b = (_a = project === null || project === void 0 ? void 0 : project.history.at(-1)) === null || _a === void 0 ? void 0 : _a.date) !== null && _b !== void 0 ? _b : project === null || project === void 0 ? void 0 : project.dates.start) !== null && _c !== void 0 ? _c : generatedAt;
            return {
                id: risk.id,
                projectId: risk.projectId,
                title: risk.title,
                status: risk.status,
                severity: deriveRiskSeverity(risk.probability, risk.impact),
                probability: risk.probability,
                impact: risk.impact,
                mitigation: risk.mitigation,
                owner: risk.owner,
                createdAt: anchor,
                updatedAt: anchor,
            };
        });
        const milestones = projects
            .filter((project) => project.nextMilestone)
            .map((project) => {
            var _a, _b;
            return ({
                id: `next-${project.id}`,
                projectId: project.id,
                title: project.nextMilestone.name,
                date: project.nextMilestone.date,
                status: new Date(project.nextMilestone.date) < new Date(generatedAt)
                    ? project.progress >= 100
                        ? "completed"
                        : "overdue"
                    : "upcoming",
                updatedAt: (_b = (_a = project.history.at(-1)) === null || _a === void 0 ? void 0 : _a.date) !== null && _b !== void 0 ? _b : generatedAt,
            });
        });
        const workReports = projects.flatMap((project, index) => {
            if (project.status === "planning") {
                return [];
            }
            const approvedDate = shiftIsoDate(generatedAt, -(index + 1));
            const pendingDate = shiftIsoDate(generatedAt, -(index + 3));
            const reports = [
                {
                    id: `wr-${project.id}-approved`,
                    projectId: project.id,
                    reportNumber: `#${project.id.toUpperCase()}-001`,
                    reportDate: approvedDate,
                    status: "approved",
                    source: "mock",
                    authorId: `author-${project.id}`,
                    reviewerId: `reviewer-${project.id}`,
                    submittedAt: approvedDate,
                    reviewedAt: approvedDate,
                },
            ];
            if (project.status === "at-risk" || project.priority === "critical") {
                reports.push({
                    id: `wr-${project.id}-submitted`,
                    projectId: project.id,
                    reportNumber: `#${project.id.toUpperCase()}-002`,
                    reportDate: pendingDate,
                    status: "submitted",
                    source: "mock",
                    authorId: `author-${project.id}`,
                    reviewerId: null,
                    submittedAt: pendingDate,
                    reviewedAt: null,
                });
            }
            return reports;
        });
        const teamMembers = getMockTeam()
            .filter((member) => member.projects.some((candidate) => allowedProjectIds.has(candidate)))
            .map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            capacity: member.capacity,
            allocated: member.allocated,
            projectIds: member.projects.filter((candidate) => allowedProjectIds.has(candidate)),
        }));
        return {
            generatedAt,
            projects,
            tasks,
            risks,
            milestones,
            workReports,
            teamMembers,
        };
    });
}
function buildLiveExecutiveSnapshot() {
    return __awaiter(this, arguments, void 0, function* (filter = {}) {
        const generatedAt = normalizeTimestamp(filter.generatedAt);
        const projectWhere = filter.projectId ? { id: filter.projectId } : undefined;
        const liveProjects = yield prisma.project.findMany({
            where: projectWhere,
            include: {
                tasks: {
                    include: {
                        assignee: {
                            select: { id: true, name: true },
                        },
                    },
                },
                risks: {
                    include: {
                        owner: {
                            select: { name: true },
                        },
                    },
                },
                milestones: true,
                workReports: {
                    select: {
                        id: true,
                        reportNumber: true,
                        reportDate: true,
                        status: true,
                        source: true,
                        authorId: true,
                        reviewerId: true,
                        submittedAt: true,
                        reviewedAt: true,
                    },
                },
                team: {
                    select: {
                        id: true,
                        name: true,
                        role: true,
                        capacity: true,
                    },
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        if (liveProjects.length === 0) {
            return {
                generatedAt,
                projects: [],
                tasks: [],
                risks: [],
                milestones: [],
                workReports: [],
                teamMembers: [],
            };
        }
        const allowedProjectIds = new Set(liveProjects.map((project) => project.id));
        const liveTeamMembers = yield prisma.teamMember.findMany({
            where: allowedProjectIds.size
                ? {
                    OR: [
                        {
                            projects: {
                                some: {
                                    id: {
                                        in: Array.from(allowedProjectIds),
                                    },
                                },
                            },
                        },
                        {
                            tasks: {
                                some: {
                                    projectId: {
                                        in: Array.from(allowedProjectIds),
                                    },
                                },
                            },
                        },
                    ],
                }
                : undefined,
            include: {
                projects: {
                    select: {
                        id: true,
                    },
                },
                tasks: {
                    where: {
                        projectId: {
                            in: Array.from(allowedProjectIds),
                        },
                        status: {
                            not: "done",
                        },
                    },
                    select: {
                        id: true,
                    },
                },
            },
            orderBy: { name: "asc" },
        });
        const projects = liveProjects.map((project) => {
            var _a, _b, _c;
            const nextMilestone = selectNextMilestone(project.milestones);
            return {
                id: project.id,
                name: project.name,
                description: (_a = project.description) !== null && _a !== void 0 ? _a : undefined,
                status: normalizeProjectStatus(project.status),
                priority: project.priority,
                progress: project.progress,
                health: mapHealthToScore(project.health, project.status, project.progress),
                direction: project.direction,
                location: project.location,
                budget: {
                    planned: (_b = project.budgetPlan) !== null && _b !== void 0 ? _b : 0,
                    actual: (_c = project.budgetFact) !== null && _c !== void 0 ? _c : 0,
                    currency: DEFAULT_CURRENCY,
                },
                dates: {
                    start: project.start.toISOString(),
                    end: project.end.toISOString(),
                },
                nextMilestone,
                history: [],
            };
        });
        const tasks = liveProjects.flatMap((project) => project.tasks.map((task) => {
            var _a, _b, _c, _d, _e, _f;
            return ({
                id: task.id,
                projectId: project.id,
                title: task.title,
                status: normalizeTaskStatus(task.status),
                priority: task.priority,
                dueDate: (_b = (_a = task.dueDate) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
                createdAt: task.createdAt.toISOString(),
                completedAt: (_d = (_c = task.completedAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
                assigneeId: task.assigneeId,
                assigneeName: (_f = (_e = task.assignee) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
            });
        }));
        const risks = liveProjects.flatMap((project) => project.risks.map((risk) => {
            var _a, _b, _c;
            return ({
                id: risk.id,
                projectId: project.id,
                title: risk.title,
                status: risk.status,
                severity: Math.max(1, Math.min(5, risk.severity || 1)),
                probability: mapProbability(risk.probability),
                impact: mapImpact(risk.impact),
                mitigation: (_a = risk.description) !== null && _a !== void 0 ? _a : undefined,
                owner: (_c = (_b = risk.owner) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                createdAt: risk.createdAt.toISOString(),
                updatedAt: risk.updatedAt.toISOString(),
            });
        }));
        const milestones = liveProjects.flatMap((project) => project.milestones.map((milestone) => ({
            id: milestone.id,
            projectId: project.id,
            title: milestone.title,
            date: milestone.date.toISOString(),
            status: milestone.status,
            updatedAt: milestone.updatedAt.toISOString(),
        })));
        const workReports = liveProjects.flatMap((project) => project.workReports.map((report) => {
            var _a, _b;
            return ({
                id: report.id,
                projectId: project.id,
                reportNumber: report.reportNumber,
                reportDate: report.reportDate.toISOString(),
                status: report.status,
                source: report.source,
                authorId: report.authorId,
                reviewerId: report.reviewerId,
                submittedAt: report.submittedAt.toISOString(),
                reviewedAt: (_b = (_a = report.reviewedAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
            });
        }));
        const teamMembers = liveTeamMembers.map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            capacity: member.capacity,
            allocated: Math.min(100, member.tasks.length * 25),
            projectIds: member.projects
                .map((project) => project.id)
                .filter((projectId) => allowedProjectIds.has(projectId)),
        }));
        return {
            generatedAt,
            projects,
            tasks,
            risks,
            milestones,
            workReports,
            teamMembers,
        };
    });
}
function normalizeTimestamp(value) {
    if (!value) {
        return new Date().toISOString();
    }
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function normalizeProjectStatus(value) {
    if (value === "at_risk")
        return "at-risk";
    if (value === "on_hold")
        return "on-hold";
    return value;
}
function normalizeTaskStatus(value) {
    if (value === "in_progress")
        return "in-progress";
    return value;
}
function mapHealthToScore(health, status, progress) {
    var _a;
    if (status === "completed" || progress >= 100) {
        return 95;
    }
    if (status === "at_risk") {
        return 35;
    }
    if (status === "on_hold") {
        return 48;
    }
    return (_a = HEALTH_MAP[health]) !== null && _a !== void 0 ? _a : 65;
}
function mapProbability(value) {
    var _a;
    return (_a = PROBABILITY_MAP[value]) !== null && _a !== void 0 ? _a : 0.5;
}
function mapImpact(value) {
    var _a;
    return (_a = IMPACT_MAP[value]) !== null && _a !== void 0 ? _a : 0.5;
}
function selectNextMilestone(milestones) {
    const activeMilestone = milestones
        .filter((milestone) => milestone.status !== "completed")
        .sort((left, right) => left.date.getTime() - right.date.getTime())[0];
    if (!activeMilestone) {
        return null;
    }
    return {
        name: activeMilestone.title,
        date: activeMilestone.date.toISOString(),
    };
}
function deriveRiskSeverity(probability, impact) {
    const weighted = ((probability + impact) / 2) * 5;
    return Math.max(1, Math.min(5, Math.round(weighted)));
}
function shiftIsoDate(value, days) {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString();
}
