import {
  buildDashboardStateFromApi,
  type ApiMilestone,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
  type ApiTeamMember,
} from '../client/normalizers';
import type {
  ExecutiveProject,
  ExecutiveRisk,
  ExecutiveSnapshot,
  ExecutiveTask,
  ExecutiveTeamMember,
} from '../briefs/types';

export function buildDashboardStateFromExecutiveSnapshot(
  snapshot: ExecutiveSnapshot
) {
  const projectNameById = new Map(
    snapshot.projects.map((project) => [project.id, project.name])
  );

  const apiProjects = snapshot.projects.map((project) =>
    toApiProject(project, snapshot, projectNameById)
  );
  const apiTasks = snapshot.tasks.map((task) => toApiTask(task, snapshot.generatedAt));
  const apiTeam = snapshot.teamMembers.map((member) =>
    toApiTeamMember(member, projectNameById)
  );
  const apiRisks = snapshot.risks.map(toApiRisk);

  return buildDashboardStateFromApi({
    projects: apiProjects,
    tasks: apiTasks,
    team: apiTeam,
    risks: apiRisks,
  });
}

function toApiProject(
  project: ExecutiveProject,
  snapshot: ExecutiveSnapshot,
  projectNameById: Map<string, string>
): ApiProject {
  const team = snapshot.teamMembers
    .filter((member) => member.projectIds.includes(project.id))
    .map((member) => toApiTeamMember(member, projectNameById));
  const risks = snapshot.risks
    .filter((risk) => risk.projectId === project.id)
    .map(toApiRisk);
  const milestones = snapshot.milestones
    .filter((milestone) => milestone.projectId === project.id)
    .map<ApiMilestone>((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      date: milestone.date,
      status: normalizeProjectMilestoneStatus(milestone.status),
      projectId: milestone.projectId,
    }));

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    status: normalizeProjectStatus(project.status),
    direction: project.direction ?? "construction",
    priority: project.priority,
    health: project.health,
    start: project.dates.start,
    end: project.dates.end,
    createdAt: project.dates.start,
    updatedAt: snapshot.generatedAt,
    budgetPlan: project.budget.planned,
    budgetFact: project.budget.actual,
    progress: project.progress,
    location: project.location ?? null,
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

function toApiTask(task: ExecutiveTask, generatedAt: string): ApiTask {
  return {
    id: task.id,
    title: task.title,
    description: "",
    status: normalizeTaskStatus(task.status),
    priority: task.priority,
    order: 0,
    dueDate: task.dueDate ?? generatedAt,
    completedAt: task.completedAt ?? null,
    createdAt: task.createdAt,
    updatedAt: task.completedAt ?? task.createdAt,
    projectId: task.projectId,
    assigneeId: task.assigneeId ?? null,
    assignee: task.assigneeId || task.assigneeName
      ? {
          id: task.assigneeId ?? `assignee-${task.id}`,
          name: task.assigneeName ?? "Unknown",
          role: "",
          capacity: 100,
        }
      : null,
  };
}

function toApiTeamMember(
  member: ExecutiveTeamMember,
  projectNameById: Map<string, string>
): ApiTeamMember {
  return {
    id: member.id,
    name: member.name,
    role: member.role ?? "",
    capacity: member.capacity,
    capacityUsed: member.allocated,
    projects: member.projectIds.map((projectId) => ({
      id: projectId,
      name: projectNameById.get(projectId) ?? projectId,
    })),
  };
}

function toApiRisk(risk: ExecutiveRisk): ApiRisk {
  return {
    id: risk.id,
    title: risk.title,
    description: risk.mitigation ?? null,
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

function normalizeProjectStatus(status: string) {
  if (status === "at-risk") {
    return "at_risk";
  }

  if (status === "on-hold") {
    return "on_hold";
  }

  return status;
}

function normalizeTaskStatus(status: string) {
  if (status === "in-progress") {
    return "in_progress";
  }

  return status;
}

function normalizeProjectMilestoneStatus(status: string) {
  if (status === "in-progress") {
    return "in_progress";
  }

  return status;
}

function toRiskScale(value: number) {
  if (value >= 4 || value >= 0.75) {
    return "high";
  }

  if (value >= 3 || value >= 0.45) {
    return "medium";
  }

  return "low";
}
