import { buildDashboardStateFromApi, } from '../client/normalizers';
export function buildDashboardStateFromExecutiveSnapshot(snapshot) {
    const projectNameById = new Map(snapshot.projects.map((project) => [project.id, project.name]));
    const apiProjects = snapshot.projects.map((project) => toApiProject(project, snapshot, projectNameById));
    const apiTasks = snapshot.tasks.map((task) => toApiTask(task, snapshot.generatedAt));
    const apiTeam = snapshot.teamMembers.map((member) => toApiTeamMember(member, projectNameById));
    const apiRisks = snapshot.risks.map(toApiRisk);
    return buildDashboardStateFromApi({
        projects: apiProjects,
        tasks: apiTasks,
        team: apiTeam,
        risks: apiRisks,
    });
}
function toApiProject(project, snapshot, projectNameById) {
    var _a, _b, _c;
    const team = snapshot.teamMembers
        .filter((member) => member.projectIds.includes(project.id))
        .map((member) => toApiTeamMember(member, projectNameById));
    const risks = snapshot.risks
        .filter((risk) => risk.projectId === project.id)
        .map(toApiRisk);
    const milestones = snapshot.milestones
        .filter((milestone) => milestone.projectId === project.id)
        .map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        date: milestone.date,
        status: normalizeProjectMilestoneStatus(milestone.status),
        projectId: milestone.projectId,
    }));
    return {
        id: project.id,
        name: project.name,
        description: (_a = project.description) !== null && _a !== void 0 ? _a : "",
        status: normalizeProjectStatus(project.status),
        direction: (_b = project.direction) !== null && _b !== void 0 ? _b : "construction",
        priority: project.priority,
        health: project.health,
        start: project.dates.start,
        end: project.dates.end,
        createdAt: project.dates.start,
        updatedAt: snapshot.generatedAt,
        budgetPlan: project.budget.planned,
        budgetFact: project.budget.actual,
        progress: project.progress,
        location: (_c = project.location) !== null && _c !== void 0 ? _c : null,
        team,
        risks,
        milestones,
        documents: [],
        budget: {
            planned: project.budget.planned,
            actual: project.budget.actual,
            currency: project.budget.currency,
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
        history: project.history,
    };
}
function toApiTask(task, generatedAt) {
    var _a, _b, _c, _d, _e, _f;
    return {
        id: task.id,
        title: task.title,
        description: "",
        status: normalizeTaskStatus(task.status),
        priority: task.priority,
        order: 0,
        dueDate: (_a = task.dueDate) !== null && _a !== void 0 ? _a : generatedAt,
        completedAt: (_b = task.completedAt) !== null && _b !== void 0 ? _b : null,
        createdAt: task.createdAt,
        updatedAt: (_c = task.completedAt) !== null && _c !== void 0 ? _c : task.createdAt,
        projectId: task.projectId,
        assigneeId: (_d = task.assigneeId) !== null && _d !== void 0 ? _d : null,
        assignee: task.assigneeId || task.assigneeName
            ? {
                id: (_e = task.assigneeId) !== null && _e !== void 0 ? _e : `assignee-${task.id}`,
                name: (_f = task.assigneeName) !== null && _f !== void 0 ? _f : "Unknown",
                role: "",
                capacity: 100,
            }
            : null,
    };
}
function toApiTeamMember(member, projectNameById) {
    var _a;
    return {
        id: member.id,
        name: member.name,
        role: (_a = member.role) !== null && _a !== void 0 ? _a : "",
        capacity: member.capacity,
        capacityUsed: member.allocated,
        projects: member.projectIds.map((projectId) => {
            var _a;
            return ({
                id: projectId,
                name: (_a = projectNameById.get(projectId)) !== null && _a !== void 0 ? _a : projectId,
            });
        }),
    };
}
function toApiRisk(risk) {
    var _a;
    return {
        id: risk.id,
        title: risk.title,
        description: (_a = risk.mitigation) !== null && _a !== void 0 ? _a : null,
        probability: toRiskScale(risk.probability),
        impact: toRiskScale(risk.impact),
        severity: risk.severity,
        status: risk.status,
        projectId: risk.projectId,
        owner: risk.owner
            ? {
                id: risk.id,
                name: risk.owner,
                role: "Owner",
                capacity: 100,
            }
            : null,
    };
}
function normalizeProjectStatus(status) {
    if (status === "at-risk") {
        return "at_risk";
    }
    if (status === "on-hold") {
        return "on_hold";
    }
    return status;
}
function normalizeTaskStatus(status) {
    if (status === "in-progress") {
        return "in_progress";
    }
    return status;
}
function normalizeProjectMilestoneStatus(status) {
    if (status === "in-progress") {
        return "in_progress";
    }
    return status;
}
function toRiskScale(value) {
    if (value >= 4 || value >= 0.75) {
        return "high";
    }
    if (value >= 3 || value >= 0.45) {
        return "medium";
    }
    return "low";
}
