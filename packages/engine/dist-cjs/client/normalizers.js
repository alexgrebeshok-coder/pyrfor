"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTaskStatus = normalizeTaskStatus;
exports.denormalizeTaskStatus = denormalizeTaskStatus;
exports.normalizeProjectStatus = normalizeProjectStatus;
exports.denormalizeProjectStatus = denormalizeProjectStatus;
exports.normalizeTaskDependencySummary = normalizeTaskDependencySummary;
exports.normalizeTask = normalizeTask;
exports.normalizeTeamMember = normalizeTeamMember;
exports.normalizeRisk = normalizeRisk;
exports.normalizeMilestone = normalizeMilestone;
exports.normalizeDocument = normalizeDocument;
exports.normalizeProject = normalizeProject;
exports.buildDashboardStateFromApi = buildDashboardStateFromApi;
const date_fns_1 = require("date-fns");
const TASK_STATUS_DB_TO_UI = {
    todo: "todo",
    in_progress: "in-progress",
    blocked: "blocked",
    done: "done",
};
const TASK_STATUS_UI_TO_DB = {
    todo: "todo",
    "in-progress": "in_progress",
    blocked: "blocked",
    done: "done",
};
const PROJECT_STATUS_DB_TO_UI = {
    active: "active",
    planning: "planning",
    on_hold: "on-hold",
    completed: "completed",
    at_risk: "at-risk",
};
const PROJECT_STATUS_UI_TO_DB = {
    active: "active",
    planning: "planning",
    "on-hold": "on_hold",
    completed: "completed",
    "at-risk": "at_risk",
};
const RISK_STATUS_MAP = {
    open: "open",
    mitigating: "mitigating",
    mitigated: "mitigated",
    closed: "closed",
};
const RISK_SCALE = {
    low: 2,
    medium: 3,
    high: 5,
};
const HEALTH_TO_SCORE = {
    good: 86,
    warning: 63,
    critical: 42,
};
const MILESTONE_STATUS_TO_PROJECT_STATUS = {
    upcoming: "planning",
    in_progress: "active",
    completed: "completed",
    overdue: "at-risk",
};
function asDateOnly(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return (0, date_fns_1.format)(new Date(), "yyyy-MM-dd");
    }
    return (0, date_fns_1.format)(date, "yyyy-MM-dd");
}
function formatFileSize(size) {
    if (!size || size <= 0)
        return "Unknown";
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
        return `${Math.round(size / 1024)} KB`;
    }
    return `${size} B`;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function buildSyntheticHistory(start, progress, budgetPlan, budgetActual) {
    return [
        {
            date: asDateOnly(start),
            progress: Math.max(progress - 14, 0),
            budgetPlanned: Math.round(budgetPlan * 0.14),
            budgetActual: Math.round(budgetActual * 0.08),
        },
        {
            date: asDateOnly(new Date()),
            progress,
            budgetPlanned: Math.round(budgetPlan * 0.38),
            budgetActual,
        },
    ];
}
function buildDefaultObjectives(project) {
    return [
        `Удержать delivery rhythm по направлению ${project.direction}.`,
        `Подтвердить ближайшие шаги по локации ${project.location ?? "проекта"}.`,
        "Подготовить управленческие решения по срокам, бюджету и рискам.",
    ];
}
function deriveMaterials(progress, riskCount) {
    return clamp(Math.round(38 + progress * 0.45 - riskCount * 4), 18, 96);
}
function deriveLaborProductivity(progress, teamSize) {
    return clamp(Math.round(44 + progress * 0.38 + teamSize * 2), 24, 98);
}
function deriveSafety(projectStatus, riskCount) {
    const riskModifier = projectStatus === "at-risk" ? 0.22 : projectStatus === "planning" ? 0.08 : 0.04;
    return {
        ltifr: Number((0.12 + riskModifier + riskCount * 0.03).toFixed(2)),
        trir: Number((0.36 + riskModifier * 2 + riskCount * 0.05).toFixed(2)),
    };
}
function normalizeTaskStatus(status) {
    return TASK_STATUS_DB_TO_UI[status] ?? "todo";
}
function denormalizeTaskStatus(status) {
    return TASK_STATUS_UI_TO_DB[status] ?? "todo";
}
function normalizeProjectStatus(status) {
    return PROJECT_STATUS_DB_TO_UI[status] ?? "planning";
}
function denormalizeProjectStatus(status) {
    return PROJECT_STATUS_UI_TO_DB[status] ?? "planning";
}
function normalizeTaskDependencySummary(summary) {
    if (!summary) {
        return undefined;
    }
    return {
        dependencyCount: summary.dependencyCount,
        dependentCount: summary.dependentCount,
        blockingDependencyCount: summary.blockingDependencyCount,
        downstreamImpactCount: summary.downstreamImpactCount,
        blockedByDependencies: summary.blockedByDependencies,
        earliestBlockingDueDate: summary.earliestBlockingDueDate
            ? asDateOnly(summary.earliestBlockingDueDate)
            : null,
        blockingDependencies: summary.blockingDependencies.map((dependency) => ({
            id: dependency.id,
            title: dependency.title,
            status: normalizeTaskStatus(dependency.status),
            dueDate: asDateOnly(dependency.dueDate),
            type: dependency.type,
        })),
    };
}
function normalizeTask(task) {
    const status = normalizeTaskStatus(task.status);
    const dependencySummary = normalizeTaskDependencySummary(task.dependencySummary);
    return {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        description: task.description ?? "",
        status,
        order: task.order ?? 0,
        assignee: task.assignee ? {
            id: task.assignee.id,
            name: task.assignee.name,
            initials: task.assignee.initials,
        } : null,
        dueDate: asDateOnly(task.dueDate),
        priority: task.priority ?? "medium",
        tags: [],
        createdAt: asDateOnly(task.createdAt),
        blockedReason: task.blockedReason?.trim() ||
            (status === "blocked"
                ? "Task is blocked, but no reason is linked in the API workflow yet."
                : undefined),
        dependencySummary,
    };
}
function normalizeTeamMember(member) {
    const allocated = member.capacityUsed ??
        Math.min(100, (member.activeTasks ?? 0) * 20);
    return {
        id: member.id,
        name: member.name,
        role: member.role,
        email: member.email ?? "",
        capacity: member.capacity ?? 100,
        allocated,
        projects: member.projects
            ?.map((project) => typeof project === "string" ? project : project.name ?? null)
            .filter((projectName) => typeof projectName === "string" && projectName.trim().length > 0) ?? [],
        location: "Remote",
    };
}
function normalizeRisk(risk) {
    return {
        id: risk.id,
        projectId: risk.projectId,
        title: risk.title,
        description: risk.description ?? null,
        ownerId: risk.ownerId ?? null,
        owner: risk.owner?.name ?? "Not assigned",
        probability: RISK_SCALE[risk.probability] ?? 3,
        impact: RISK_SCALE[risk.impact] ?? 3,
        status: RISK_STATUS_MAP[risk.status] ?? "open",
        mitigation: risk.description?.trim() || "Mitigation plan is being prepared in the API workflow.",
        category: "general",
    };
}
function normalizeMilestone(milestone) {
    return {
        id: milestone.id,
        projectId: milestone.projectId,
        name: milestone.title,
        start: asDateOnly(milestone.date),
        end: asDateOnly(milestone.date),
        status: MILESTONE_STATUS_TO_PROJECT_STATUS[milestone.status] ?? "planning",
        progress: milestone.status === "completed"
            ? 100
            : milestone.status === "in_progress"
                ? 52
                : milestone.status === "overdue"
                    ? 34
                    : 12,
    };
}
function normalizeDocument(document) {
    return {
        id: document.id,
        projectId: document.projectId,
        title: document.title,
        type: document.type.toUpperCase(),
        owner: document.owner?.name ?? "Unknown",
        updatedAt: asDateOnly(document.updatedAt),
        size: formatFileSize(document.size),
    };
}
function normalizeProject(project) {
    const milestones = (project.milestones ?? []).map(normalizeMilestone);
    const derivedNextMilestone = milestones
        .slice()
        .sort((left, right) => left.end.localeCompare(right.end))[0];
    const projectStatus = normalizeProjectStatus(project.status);
    const teamNames = project.team
        ?.map((member) => typeof member === "string" ? member : member.name)
        .filter((memberName) => typeof memberName === "string" && memberName.trim().length > 0) ?? [];
    const riskCount = Array.isArray(project.risks) ? project.risks.length : project.risks ?? 0;
    const progress = typeof project.progress === "number" ? project.progress : 0;
    const startDate = project.start ?? project.dates?.start ?? project.createdAt;
    const endDate = project.end ?? project.dates?.end ?? project.updatedAt;
    const plannedBudget = project.budgetPlan ?? project.budget?.planned ?? 0;
    const actualBudget = project.budgetFact ?? project.budget?.actual ?? 0;
    const nextMilestone = derivedNextMilestone
        ? { name: derivedNextMilestone.name, date: derivedNextMilestone.end }
        : project.nextMilestone?.name && project.nextMilestone?.date
            ? { name: project.nextMilestone.name, date: asDateOnly(project.nextMilestone.date) }
            : null;
    const health = typeof project.health === "number"
        ? clamp(Math.round(project.health), 0, 100)
        : HEALTH_TO_SCORE[project.health] ?? 68;
    const history = project.history && project.history.length > 0
        ? project.history.map((point) => ({
            date: asDateOnly(point.date),
            progress: typeof point.progress === "number" ? point.progress : progress,
            budgetPlanned: typeof point.budgetPlanned === "number"
                ? point.budgetPlanned
                : plannedBudget,
            budgetActual: typeof point.budgetActual === "number"
                ? point.budgetActual
                : actualBudget,
        }))
        : buildSyntheticHistory(startDate, progress, plannedBudget, actualBudget);
    return {
        id: project.id,
        name: project.name?.trim() || "Untitled project",
        description: project.description ?? "",
        status: projectStatus,
        progress,
        direction: project.direction ?? "construction",
        budget: {
            planned: plannedBudget,
            actual: actualBudget,
            currency: project.budget?.currency ?? "RUB",
        },
        dates: {
            start: asDateOnly(startDate),
            end: asDateOnly(endDate),
        },
        nextMilestone,
        team: teamNames,
        risks: riskCount,
        location: project.location ?? "TBD",
        priority: project.priority ?? "medium",
        health,
        objectives: buildDefaultObjectives(project),
        materials: deriveMaterials(progress, riskCount),
        laborProductivity: deriveLaborProductivity(progress, teamNames.length),
        safety: deriveSafety(projectStatus, riskCount),
        history,
    };
}
function buildDashboardStateFromApi(input) {
    const projects = (input.projects ?? []).map(normalizeProject);
    const tasks = (input.tasks ?? []).map(normalizeTask);
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const team = (input.team ?? []).map((member) => {
        const normalizedMember = normalizeTeamMember(member);
        return {
            ...normalizedMember,
            projects: normalizedMember.projects.map((projectRef) => projectNameById.get(projectRef) ?? projectRef),
        };
    });
    const risks = (input.risks ?? []).map(normalizeRisk);
    const documents = (input.projects ?? []).flatMap((project) => (project.documents ?? []).map(normalizeDocument));
    const milestones = (input.projects ?? []).flatMap((project) => (project.milestones ?? []).map(normalizeMilestone));
    // Default current user (will be overridden by mock data)
    const currentUser = {
        id: "user1",
        name: "Саша",
        role: "PM",
        email: "sasha@example.com",
    };
    return {
        currentUser,
        projects,
        tasks,
        team,
        risks,
        documents,
        milestones,
        auditLogEntries: [],
    };
}
