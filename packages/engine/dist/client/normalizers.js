import { format } from "date-fns";
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
        return format(new Date(), "yyyy-MM-dd");
    }
    return format(date, "yyyy-MM-dd");
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
    var _a;
    return [
        `Удержать delivery rhythm по направлению ${project.direction}.`,
        `Подтвердить ближайшие шаги по локации ${(_a = project.location) !== null && _a !== void 0 ? _a : "проекта"}.`,
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
export function normalizeTaskStatus(status) {
    var _a;
    return (_a = TASK_STATUS_DB_TO_UI[status]) !== null && _a !== void 0 ? _a : "todo";
}
export function denormalizeTaskStatus(status) {
    var _a;
    return (_a = TASK_STATUS_UI_TO_DB[status]) !== null && _a !== void 0 ? _a : "todo";
}
export function normalizeProjectStatus(status) {
    var _a;
    return (_a = PROJECT_STATUS_DB_TO_UI[status]) !== null && _a !== void 0 ? _a : "planning";
}
export function denormalizeProjectStatus(status) {
    var _a;
    return (_a = PROJECT_STATUS_UI_TO_DB[status]) !== null && _a !== void 0 ? _a : "planning";
}
export function normalizeTaskDependencySummary(summary) {
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
export function normalizeTask(task) {
    var _a, _b, _c, _d;
    const status = normalizeTaskStatus(task.status);
    const dependencySummary = normalizeTaskDependencySummary(task.dependencySummary);
    return {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        description: (_a = task.description) !== null && _a !== void 0 ? _a : "",
        status,
        order: (_b = task.order) !== null && _b !== void 0 ? _b : 0,
        assignee: task.assignee ? {
            id: task.assignee.id,
            name: task.assignee.name,
            initials: task.assignee.initials,
        } : null,
        dueDate: asDateOnly(task.dueDate),
        priority: (_c = task.priority) !== null && _c !== void 0 ? _c : "medium",
        tags: [],
        createdAt: asDateOnly(task.createdAt),
        blockedReason: ((_d = task.blockedReason) === null || _d === void 0 ? void 0 : _d.trim()) ||
            (status === "blocked"
                ? "Task is blocked, but no reason is linked in the API workflow yet."
                : undefined),
        dependencySummary,
    };
}
export function normalizeTeamMember(member) {
    var _a, _b, _c, _d, _e, _f;
    const allocated = (_a = member.capacityUsed) !== null && _a !== void 0 ? _a : Math.min(100, ((_b = member.activeTasks) !== null && _b !== void 0 ? _b : 0) * 20);
    return {
        id: member.id,
        name: member.name,
        role: member.role,
        email: (_c = member.email) !== null && _c !== void 0 ? _c : "",
        capacity: (_d = member.capacity) !== null && _d !== void 0 ? _d : 100,
        allocated,
        projects: (_f = (_e = member.projects) === null || _e === void 0 ? void 0 : _e.map((project) => { var _a; return typeof project === "string" ? project : (_a = project.name) !== null && _a !== void 0 ? _a : null; }).filter((projectName) => typeof projectName === "string" && projectName.trim().length > 0)) !== null && _f !== void 0 ? _f : [],
        location: "Remote",
    };
}
export function normalizeRisk(risk) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return {
        id: risk.id,
        projectId: risk.projectId,
        title: risk.title,
        description: (_a = risk.description) !== null && _a !== void 0 ? _a : null,
        ownerId: (_b = risk.ownerId) !== null && _b !== void 0 ? _b : null,
        owner: (_d = (_c = risk.owner) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "Not assigned",
        probability: (_e = RISK_SCALE[risk.probability]) !== null && _e !== void 0 ? _e : 3,
        impact: (_f = RISK_SCALE[risk.impact]) !== null && _f !== void 0 ? _f : 3,
        status: (_g = RISK_STATUS_MAP[risk.status]) !== null && _g !== void 0 ? _g : "open",
        mitigation: ((_h = risk.description) === null || _h === void 0 ? void 0 : _h.trim()) || "Mitigation plan is being prepared in the API workflow.",
        category: "general",
    };
}
export function normalizeMilestone(milestone) {
    var _a;
    return {
        id: milestone.id,
        projectId: milestone.projectId,
        name: milestone.title,
        start: asDateOnly(milestone.date),
        end: asDateOnly(milestone.date),
        status: (_a = MILESTONE_STATUS_TO_PROJECT_STATUS[milestone.status]) !== null && _a !== void 0 ? _a : "planning",
        progress: milestone.status === "completed"
            ? 100
            : milestone.status === "in_progress"
                ? 52
                : milestone.status === "overdue"
                    ? 34
                    : 12,
    };
}
export function normalizeDocument(document) {
    var _a, _b;
    return {
        id: document.id,
        projectId: document.projectId,
        title: document.title,
        type: document.type.toUpperCase(),
        owner: (_b = (_a = document.owner) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Unknown",
        updatedAt: asDateOnly(document.updatedAt),
        size: formatFileSize(document.size),
    };
}
export function normalizeProject(project) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1;
    const milestones = ((_a = project.milestones) !== null && _a !== void 0 ? _a : []).map(normalizeMilestone);
    const derivedNextMilestone = milestones
        .slice()
        .sort((left, right) => left.end.localeCompare(right.end))[0];
    const projectStatus = normalizeProjectStatus(project.status);
    const teamNames = (_c = (_b = project.team) === null || _b === void 0 ? void 0 : _b.map((member) => typeof member === "string" ? member : member.name).filter((memberName) => typeof memberName === "string" && memberName.trim().length > 0)) !== null && _c !== void 0 ? _c : [];
    const riskCount = Array.isArray(project.risks) ? project.risks.length : (_d = project.risks) !== null && _d !== void 0 ? _d : 0;
    const progress = typeof project.progress === "number" ? project.progress : 0;
    const startDate = (_g = (_e = project.start) !== null && _e !== void 0 ? _e : (_f = project.dates) === null || _f === void 0 ? void 0 : _f.start) !== null && _g !== void 0 ? _g : project.createdAt;
    const endDate = (_k = (_h = project.end) !== null && _h !== void 0 ? _h : (_j = project.dates) === null || _j === void 0 ? void 0 : _j.end) !== null && _k !== void 0 ? _k : project.updatedAt;
    const plannedBudget = (_o = (_l = project.budgetPlan) !== null && _l !== void 0 ? _l : (_m = project.budget) === null || _m === void 0 ? void 0 : _m.planned) !== null && _o !== void 0 ? _o : 0;
    const actualBudget = (_r = (_p = project.budgetFact) !== null && _p !== void 0 ? _p : (_q = project.budget) === null || _q === void 0 ? void 0 : _q.actual) !== null && _r !== void 0 ? _r : 0;
    const nextMilestone = derivedNextMilestone
        ? { name: derivedNextMilestone.name, date: derivedNextMilestone.end }
        : ((_s = project.nextMilestone) === null || _s === void 0 ? void 0 : _s.name) && ((_t = project.nextMilestone) === null || _t === void 0 ? void 0 : _t.date)
            ? { name: project.nextMilestone.name, date: asDateOnly(project.nextMilestone.date) }
            : null;
    const health = typeof project.health === "number"
        ? clamp(Math.round(project.health), 0, 100)
        : (_u = HEALTH_TO_SCORE[project.health]) !== null && _u !== void 0 ? _u : 68;
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
        name: ((_v = project.name) === null || _v === void 0 ? void 0 : _v.trim()) || "Untitled project",
        description: (_w = project.description) !== null && _w !== void 0 ? _w : "",
        status: projectStatus,
        progress,
        direction: (_x = project.direction) !== null && _x !== void 0 ? _x : "construction",
        budget: {
            planned: plannedBudget,
            actual: actualBudget,
            currency: (_z = (_y = project.budget) === null || _y === void 0 ? void 0 : _y.currency) !== null && _z !== void 0 ? _z : "RUB",
        },
        dates: {
            start: asDateOnly(startDate),
            end: asDateOnly(endDate),
        },
        nextMilestone,
        team: teamNames,
        risks: riskCount,
        location: (_0 = project.location) !== null && _0 !== void 0 ? _0 : "TBD",
        priority: (_1 = project.priority) !== null && _1 !== void 0 ? _1 : "medium",
        health,
        objectives: buildDefaultObjectives(project),
        materials: deriveMaterials(progress, riskCount),
        laborProductivity: deriveLaborProductivity(progress, teamNames.length),
        safety: deriveSafety(projectStatus, riskCount),
        history,
    };
}
export function buildDashboardStateFromApi(input) {
    var _a, _b, _c, _d, _e, _f;
    const projects = ((_a = input.projects) !== null && _a !== void 0 ? _a : []).map(normalizeProject);
    const tasks = ((_b = input.tasks) !== null && _b !== void 0 ? _b : []).map(normalizeTask);
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const team = ((_c = input.team) !== null && _c !== void 0 ? _c : []).map((member) => {
        const normalizedMember = normalizeTeamMember(member);
        return Object.assign(Object.assign({}, normalizedMember), { projects: normalizedMember.projects.map((projectRef) => { var _a; return (_a = projectNameById.get(projectRef)) !== null && _a !== void 0 ? _a : projectRef; }) });
    });
    const risks = ((_d = input.risks) !== null && _d !== void 0 ? _d : []).map(normalizeRisk);
    const documents = ((_e = input.projects) !== null && _e !== void 0 ? _e : []).flatMap((project) => { var _a; return ((_a = project.documents) !== null && _a !== void 0 ? _a : []).map(normalizeDocument); });
    const milestones = ((_f = input.projects) !== null && _f !== void 0 ? _f : []).flatMap((project) => { var _a; return ((_a = project.milestones) !== null && _a !== void 0 ? _a : []).map(normalizeMilestone); });
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
