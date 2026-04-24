"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadExecutiveSnapshot = loadExecutiveSnapshot;
exports.buildMockExecutiveSnapshot = buildMockExecutiveSnapshot;
const prisma_1 = require("../prisma");
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
async function loadExecutiveSnapshot(filter = {}) {
    return buildLiveExecutiveSnapshot(filter);
}
async function buildMockExecutiveSnapshot(filter = {}) {
    const { getMockProjects, getMockRisks, getMockTasks, getMockTeam, } = await Promise.resolve().then(() => __importStar(require('../mock-data')));
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
        .map((task) => ({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate || null,
        createdAt: task.createdAt,
        assigneeId: task.assignee?.id ?? null,
        assigneeName: task.assignee?.name ?? null,
        completedAt: task.status === "done" ? task.dueDate : null,
    }));
    const risks = getMockRisks()
        .filter((risk) => allowedProjectIds.has(risk.projectId))
        .map((risk) => {
        const project = projects.find((candidate) => candidate.id === risk.projectId);
        const anchor = project?.history.at(-1)?.date ?? project?.dates.start ?? generatedAt;
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
        .map((project) => ({
        id: `next-${project.id}`,
        projectId: project.id,
        title: project.nextMilestone.name,
        date: project.nextMilestone.date,
        status: new Date(project.nextMilestone.date) < new Date(generatedAt)
            ? project.progress >= 100
                ? "completed"
                : "overdue"
            : "upcoming",
        updatedAt: project.history.at(-1)?.date ?? generatedAt,
    }));
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
}
async function buildLiveExecutiveSnapshot(filter = {}) {
    const generatedAt = normalizeTimestamp(filter.generatedAt);
    const projectWhere = filter.projectId ? { id: filter.projectId } : undefined;
    const liveProjects = await prisma_1.prisma.project.findMany({
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
    const liveTeamMembers = await prisma_1.prisma.teamMember.findMany({
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
        const nextMilestone = selectNextMilestone(project.milestones);
        return {
            id: project.id,
            name: project.name,
            description: project.description ?? undefined,
            status: normalizeProjectStatus(project.status),
            priority: project.priority,
            progress: project.progress,
            health: mapHealthToScore(project.health, project.status, project.progress),
            direction: project.direction,
            location: project.location,
            budget: {
                planned: project.budgetPlan ?? 0,
                actual: project.budgetFact ?? 0,
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
    const tasks = liveProjects.flatMap((project) => project.tasks.map((task) => ({
        id: task.id,
        projectId: project.id,
        title: task.title,
        status: normalizeTaskStatus(task.status),
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
    })));
    const risks = liveProjects.flatMap((project) => project.risks.map((risk) => ({
        id: risk.id,
        projectId: project.id,
        title: risk.title,
        status: risk.status,
        severity: Math.max(1, Math.min(5, risk.severity || 1)),
        probability: mapProbability(risk.probability),
        impact: mapImpact(risk.impact),
        mitigation: risk.description ?? undefined,
        owner: risk.owner?.name ?? null,
        createdAt: risk.createdAt.toISOString(),
        updatedAt: risk.updatedAt.toISOString(),
    })));
    const milestones = liveProjects.flatMap((project) => project.milestones.map((milestone) => ({
        id: milestone.id,
        projectId: project.id,
        title: milestone.title,
        date: milestone.date.toISOString(),
        status: milestone.status,
        updatedAt: milestone.updatedAt.toISOString(),
    })));
    const workReports = liveProjects.flatMap((project) => project.workReports.map((report) => ({
        id: report.id,
        projectId: project.id,
        reportNumber: report.reportNumber,
        reportDate: report.reportDate.toISOString(),
        status: report.status,
        source: report.source,
        authorId: report.authorId,
        reviewerId: report.reviewerId,
        submittedAt: report.submittedAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
    })));
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
    if (status === "completed" || progress >= 100) {
        return 95;
    }
    if (status === "at_risk") {
        return 35;
    }
    if (status === "on_hold") {
        return 48;
    }
    return HEALTH_MAP[health] ?? 65;
}
function mapProbability(value) {
    return PROBABILITY_MAP[value] ?? 0.5;
}
function mapImpact(value) {
    return IMPACT_MAP[value] ?? 0.5;
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
