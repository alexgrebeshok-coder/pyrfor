import type { ExpensesResponse } from "@/components/expenses/types";
import type { ContractView } from "@/components/resources/types";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { ExecutiveSnapshot } from "@/lib/briefs/types";
import type {
  ApiDocument,
  ApiMilestone,
  ApiProject,
  ApiRisk,
  ApiTask,
  ApiTeamMember,
} from "@/lib/client/normalizers";
import type { GpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import type { EnterpriseTruthOverview } from "@/lib/enterprise-truth/types";
import type { EscalationListResult } from "@/lib/escalations/types";
import type { KnowledgeLoopOverview } from "@/lib/knowledge/types";
import { initialDashboardState } from "@/lib/mock-data";
import type { DashboardState, Project, Risk, Task, TeamMember } from "@/lib/types";
import type {
  AnalyticsOverviewProject,
  AnalyticsOverviewResponse,
  AnalyticsRecommendation,
  AnalyticsRecommendationsResponse,
  BudgetData,
  RiskData,
} from "@/lib/types/analytics";
import type { TeamPerformanceResponse } from "@/lib/types/team-performance";
import type { VideoFactListResult } from "@/lib/video-facts/types";
import type { WorkReportView } from "@/lib/work-reports/types";

type DemoProjectStatusApi = "active" | "planning" | "completed" | "at_risk" | "on_hold";
type DemoTaskStatusApi = "todo" | "in_progress" | "done" | "blocked";
type DemoRiskScaleApi = "low" | "medium" | "high";

type DemoEvmMetricPayload = {
  BAC: number;
  PV: number;
  EV: number;
  AC: number;
  CV: number;
  SV: number;
  CPI: number;
  SPI: number;
  EAC: number;
  ETC: number;
  VAC: number;
  TCPI: number | null;
  TCPI_EAC: number | null;
};

type DemoPortfolioEvmResponse = {
  referenceDate: string;
  metrics: DemoEvmMetricPayload;
  projects: Array<{
    projectId: string;
    projectName: string;
    source: "project_budget";
    metrics: DemoEvmMetricPayload;
    summary: {
      taskCount: number;
      costedTaskCount: number;
      taskBudgetCoverage: number;
    };
  }>;
  summary: {
    projectCount: number;
    taskCount: number;
    costedTaskCount: number;
  };
};

type DemoEvmHistoryResponse = {
  projectId: string;
  snapshots: Array<{
    id: string;
    date: string;
    bac: number;
    pv: number;
    ev: number;
    ac: number;
    cpi: number | null;
    spi: number | null;
    eac: number | null;
    tcpi: number | null;
  }>;
};

type DemoProjectsFinanceResponse = {
  projects: Array<{
    id: string;
    name: string;
    start: string;
    end: string;
    budgetPlan: number | null;
    budgetFact: number | null;
  }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const demoProjectOverrides: Record<
  string,
  Partial<Pick<Project, "name" | "description" | "location">> & {
    nextMilestoneName?: string;
  }
> = {
  p1: {
    name: "Северный логистический коридор",
    description:
      "Запуск и стабилизация северного плеча с контрольной картой маршрутов, SLA и логистических узких мест.",
    location: "Сургут",
    nextMilestoneName: "Пуск первого северного маршрута",
  },
  p2: {
    name: "Тюменский управляющий кампус",
    description:
      "Подготовка новой штабной площадки, инженерного контура и executive-инфраструктуры для управляющей команды.",
    location: "Тюмень",
    nextMilestoneName: "Закрыть корректировку CAPEX",
  },
  p3: {
    name: "Контур мобильных инспекций",
    description:
      "Полевая мобильная витрина для инспекций, чек-листов и подтверждения работ на ходу.",
    location: "Екатеринбург",
    nextMilestoneName: "Релиз мобильного пакета",
  },
  p4: {
    name: "Складской парк Восток",
    description:
      "Новый складской узел класса A с автоматизированным хранением и стыковкой к полевому контуру.",
    location: "Казань",
    nextMilestoneName: "Монтаж автоматизированного хранения",
  },
  p5: {
    name: "Контур управленческой отчётности",
    description:
      "Сборка единого decision layer: morning brief, evidence, финансы, риски и next action в одном месте.",
    location: "Москва",
    nextMilestoneName: "Демонстрация executive-пакета v2",
  },
  p6: {
    name: "Реконструкция операционного центра",
    description:
      "Обновление распределительного офиса и инженерных систем с жёстким контролем стоимости и сроков.",
    location: "Новосибирск",
    nextMilestoneName: "Утвердить новый график реконструкции",
  },
};

const demoExpenseCategories = [
  { id: "exp-cat-logistics", name: "Логистика", code: "LOG", color: "#2563eb" },
  { id: "exp-cat-site", name: "Площадка", code: "SITE", color: "#0f766e" },
  { id: "exp-cat-it", name: "IT и автоматизация", code: "IT", color: "#7c3aed" },
  { id: "exp-cat-procurement", name: "Закупки", code: "PROC", color: "#ea580c" },
] as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function shiftIsoDate(base: string, days: number) {
  return new Date(new Date(base).getTime() + days * DAY_MS).toISOString();
}

function toApiProjectStatus(status: Project["status"]): DemoProjectStatusApi {
  switch (status) {
    case "at-risk":
      return "at_risk";
    case "on-hold":
      return "on_hold";
    default:
      return status;
  }
}

function toApiTaskStatus(status: Task["status"]): DemoTaskStatusApi {
  switch (status) {
    case "in-progress":
      return "in_progress";
    default:
      return status;
  }
}

function toApiRiskScale(value: number): DemoRiskScaleApi {
  if (value >= 5) return "high";
  if (value <= 2) return "low";
  return "medium";
}

function toRiskLevel(severity: number): RiskData["level"] {
  if (severity >= 20) return "critical";
  if (severity >= 12) return "high";
  if (severity >= 6) return "medium";
  return "low";
}

function buildDemoDashboardState(): DashboardState {
  const state = cloneJson(initialDashboardState);

  state.currentUser = {
    ...state.currentUser,
    name: "HQ Demo",
    email: "demo@ceoclaw.app",
    role: "PM",
  };

  state.projects = state.projects.map((project) => {
    const override = demoProjectOverrides[project.id];
    if (!override) {
      return project;
    }

    return {
      ...project,
      description: override.description ?? project.description,
      location: override.location ?? project.location,
      name: override.name ?? project.name,
      nextMilestone: project.nextMilestone
        ? {
            ...project.nextMilestone,
            name: override.nextMilestoneName ?? project.nextMilestone.name,
          }
        : project.nextMilestone,
    };
  });

  state.documents = state.documents.map((document) => {
    const project = state.projects.find((item) => item.id === document.projectId);
    return {
      ...document,
      title: project ? `${document.title} · ${project.name}` : document.title,
    };
  });

  return state;
}

export const demoDashboardState = buildDemoDashboardState();

const projectById = new Map(demoDashboardState.projects.map((project) => [project.id, project]));
const teamById = new Map(demoDashboardState.team.map((member) => [member.id, member]));
const teamByName = new Map(demoDashboardState.team.map((member) => [member.name, member]));
const tasksByProject = new Map<string, Task[]>();
const risksByProject = new Map<string, Risk[]>();

for (const task of demoDashboardState.tasks) {
  const list = tasksByProject.get(task.projectId) ?? [];
  list.push(task);
  tasksByProject.set(task.projectId, list);
}

for (const risk of demoDashboardState.risks) {
  const list = risksByProject.get(risk.projectId) ?? [];
  list.push(risk);
  risksByProject.set(risk.projectId, list);
}

function buildApiTeamMember(member: TeamMember): ApiTeamMember {
  const activeTasks = demoDashboardState.tasks.filter(
    (task) => task.assignee?.name === member.name && task.status !== "done"
  ).length;

  return {
    id: member.id,
    name: member.name,
    initials: member.name
      .split(" ")
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    role: member.role,
    email: member.email,
    capacity: member.capacity,
    activeTasks,
    capacityUsed: member.allocated,
    projects: member.projects.map((projectId) => ({
      id: projectId,
      name: projectById.get(projectId)?.name ?? projectId,
    })),
  };
}

function buildApiMilestones(project: Project): ApiMilestone[] {
  if (!project.nextMilestone) {
    return [];
  }

  return [
    {
      id: `demo-milestone-${project.id}`,
      title: project.nextMilestone.name,
      date: project.nextMilestone.date,
      status: project.status === "completed" ? "completed" : project.status === "at-risk" ? "overdue" : "upcoming",
      projectId: project.id,
    },
  ];
}

function buildApiDocuments(project: Project): ApiDocument[] {
  return demoDashboardState.documents
    .filter((document) => document.projectId === project.id)
    .map((document) => {
      const owner = teamByName.get(document.owner);
      const sizeParts = document.size.split(" ");
      const sizeValue = Number(sizeParts[0] ?? 0);
      const multiplier =
        sizeParts[1]?.toLowerCase() === "mb" ? 1024 * 1024 : sizeParts[1]?.toLowerCase() === "kb" ? 1024 : 1;

      return {
        id: document.id,
        projectId: document.projectId,
        title: document.title,
        description: `${project.name}: ${document.type}`,
        filename: `${document.id}.${document.type.toLowerCase()}`,
        url: "#",
        type: document.type.toLowerCase(),
        size: Number.isFinite(sizeValue) ? Math.round(sizeValue * multiplier) : 0,
        ownerId: owner?.id ?? null,
        updatedAt: document.updatedAt,
        owner: owner ? buildApiTeamMember(owner) : null,
      };
    });
}

function buildApiRisks(project: Project): ApiRisk[] {
  return (risksByProject.get(project.id) ?? []).map((risk) => {
    const owner = risk.ownerId ? teamById.get(risk.ownerId) : teamByName.get(risk.owner);
    return {
      id: risk.id,
      title: risk.title,
      description: risk.description ?? risk.mitigation,
      probability: toApiRiskScale(risk.probability),
      impact: toApiRiskScale(risk.impact),
      severity: Math.round((risk.probability + risk.impact) / 2),
      status: risk.status,
      projectId: risk.projectId,
      ownerId: owner?.id ?? null,
      owner: owner ? buildApiTeamMember(owner) : null,
    };
  });
}

export function getDemoApiTasks(): ApiTask[] {
  return demoDashboardState.tasks.map((task) => {
    const assignee = task.assignee?.id ? teamById.get(task.assignee.id) : task.assignee?.name ? teamByName.get(task.assignee.name) : null;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: toApiTaskStatus(task.status),
      priority: task.priority,
      order: task.order,
      dueDate: task.dueDate,
      completedAt: task.status === "done" ? task.dueDate : null,
      createdAt: task.createdAt,
      updatedAt: task.dueDate,
      projectId: task.projectId,
      assigneeId: assignee?.id ?? null,
      assignee: assignee ? buildApiTeamMember(assignee) : null,
      blockedReason: task.blockedReason ?? null,
      dependencySummary: task.dependencySummary
        ? {
            ...task.dependencySummary,
            blockingDependencies: task.dependencySummary.blockingDependencies.map((dependency) => ({
              ...dependency,
              status: toApiTaskStatus(dependency.status),
            })),
          }
        : null,
    };
  });
}

export function getDemoApiTeam(): ApiTeamMember[] {
  return demoDashboardState.team.map(buildApiTeamMember);
}

export function getDemoApiProjects(): ApiProject[] {
  return demoDashboardState.projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: toApiProjectStatus(project.status),
    direction: project.direction,
    priority: project.priority,
    health: project.health,
    start: project.dates.start,
    end: project.dates.end,
    createdAt: project.dates.start,
    updatedAt: project.history.at(-1)?.date ?? project.dates.end,
    budgetPlan: project.budget.planned,
    budgetFact: project.budget.actual,
    progress: project.progress,
    location: project.location,
    team: project.team
      .map((memberName) => teamByName.get(memberName))
      .filter((member): member is TeamMember => Boolean(member))
      .map(buildApiTeamMember),
    tasks: getDemoApiTasks().filter((task) => task.projectId === project.id),
    risks: buildApiRisks(project),
    milestones: buildApiMilestones(project),
    documents: buildApiDocuments(project),
    budget: {
      planned: project.budget.planned,
      actual: project.budget.actual,
      currency: project.budget.currency,
    },
    dates: {
      start: project.dates.start,
      end: project.dates.end,
    },
    nextMilestone: project.nextMilestone,
    history: project.history,
  }));
}

export function getDemoApiRisks(): ApiRisk[] {
  return demoDashboardState.projects.flatMap(buildApiRisks);
}

export function getDemoBudgetData(): BudgetData[] {
  return demoDashboardState.projects
    .map((project) => {
      const planned = project.budget.planned;
      const actual = project.budget.actual;
      const variance = planned - actual;

      return {
        project: project.name,
        planned,
        actual,
        variance,
        variancePercent: planned > 0 ? Math.round((variance / planned) * 1000) / 10 : 0,
      };
    })
    .sort((left, right) => right.planned - left.planned);
}

export function getDemoRiskData(projectId?: string): RiskData[] {
  return demoDashboardState.risks
    .filter((risk) => (projectId ? risk.projectId === projectId : true))
    .map((risk) => {
      const severity = risk.probability * risk.impact;
      return {
        id: risk.id,
        projectId: risk.projectId,
        projectName: projectById.get(risk.projectId)?.name ?? risk.projectId,
        title: risk.title,
        probability: risk.probability,
        impact: risk.impact,
        severity,
        level: toRiskLevel(severity),
        status: risk.status === "mitigated" ? "mitigating" : risk.status === "closed" ? "closed" : "open",
        category: risk.category,
        createdAt: projectById.get(risk.projectId)?.dates.start ?? demoDashboardState.projects[0]?.dates.start ?? new Date().toISOString(),
        updatedAt: projectById.get(risk.projectId)?.history.at(-1)?.date ?? new Date().toISOString(),
      };
    });
}

function buildOverviewProject(project: Project): AnalyticsOverviewProject {
  const projectTasks = tasksByProject.get(project.id) ?? [];
  const projectRisks = risksByProject.get(project.id) ?? [];
  const overdueTasks = projectTasks.filter((task) => task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10)).length;
  const plannedProgress = Math.min(100, Math.round((project.history.at(-1)?.progress ?? project.progress) + (project.status === "planning" ? 18 : 9)));
  const actualProgress = project.progress;
  const progressVariance = actualProgress - plannedProgress;
  const budgetVariance = project.budget.planned - project.budget.actual;
  const budgetVarianceRatio = project.budget.planned > 0 ? budgetVariance / project.budget.planned : 0;
  const ev = project.budget.planned * (project.progress / 100);
  const pv = Math.max(project.history.at(-1)?.budgetPlanned ?? ev, 1);
  const ac = Math.max(project.budget.actual, 1);

  return {
    projectId: project.id,
    projectName: project.name,
    totalTasks: projectTasks.length,
    statusBreakdown: {
      todo: projectTasks.filter((task) => task.status === "todo").length,
      inProgress: projectTasks.filter((task) => task.status === "in-progress").length,
      blocked: projectTasks.filter((task) => task.status === "blocked").length,
      done: projectTasks.filter((task) => task.status === "done").length,
    },
    priorityBreakdown: {
      high: projectTasks.filter((task) => task.priority === "high" || task.priority === "critical").length,
      medium: projectTasks.filter((task) => task.priority === "medium").length,
      low: projectTasks.filter((task) => task.priority === "low").length,
    },
    progress: project.progress,
    overdueTasks,
    healthScore: project.health,
    status: project.health >= 80 ? "healthy" : project.health >= 55 ? "at_risk" : "critical",
    planFact: {
      plannedProgress,
      actualProgress,
      progressVariance,
      budgetVariance,
      budgetVarianceRatio,
      cpi: Number((ev / ac).toFixed(2)),
      spi: Number((ev / pv).toFixed(2)),
      warningCount: overdueTasks + projectRisks.length,
    },
  };
}

export function getDemoAnalyticsOverview(): AnalyticsOverviewResponse {
  const projects = demoDashboardState.projects.map(buildOverviewProject);
  const completedTasks = demoDashboardState.tasks.filter((task) => task.status === "done").length;
  const overdueTasks = projects.reduce((sum, project) => sum + project.overdueTasks, 0);
  const planFactProjectsBehind = projects.filter((project) => project.planFact.progressVariance < 0).length;
  const planFactProjectsOverBudget = projects.filter((project) => project.planFact.budgetVarianceRatio < 0).length;

  const summary = {
    totalProjects: demoDashboardState.projects.length,
    totalTasks: demoDashboardState.tasks.length,
    avgProgress: Math.round(
      demoDashboardState.projects.reduce((sum, project) => sum + project.progress, 0) /
        Math.max(demoDashboardState.projects.length, 1)
    ),
    totalOverdue: overdueTasks,
    avgHealthScore: Math.round(
      demoDashboardState.projects.reduce((sum, project) => sum + project.health, 0) /
        Math.max(demoDashboardState.projects.length, 1)
    ),
    activeProjects: demoDashboardState.projects.filter((project) => project.status === "active").length,
    completedProjects: demoDashboardState.projects.filter((project) => project.status === "completed").length,
    completedTasks,
    overdueTasks,
    teamSize: demoDashboardState.team.length,
    averageHealth: Math.round(
      demoDashboardState.projects.reduce((sum, project) => sum + project.health, 0) /
        Math.max(demoDashboardState.projects.length, 1)
    ),
    planFact: {
      portfolioCpi: 0.96,
      portfolioSpi: 0.91,
      projectsBehindPlan: planFactProjectsBehind,
      projectsOverBudget: planFactProjectsOverBudget,
      staleFieldReportingProjects: demoDashboardState.projects.filter((project) => project.status === "at-risk").length,
      criticalProjects: demoDashboardState.projects.filter((project) => project.status === "at-risk" || project.priority === "critical").length,
    },
  };

  return { summary, projects };
}

export function getDemoAnalyticsRecommendations(): AnalyticsRecommendationsResponse {
  const overdueProject = demoDashboardState.projects.find((project) => project.status === "at-risk");
  const financeProject = demoDashboardState.projects.find((project) => project.budget.actual > project.budget.planned);
  const resourceProject = demoDashboardState.projects.find((project) => project.progress < 30 && project.status !== "completed");

  const recommendations: AnalyticsRecommendation[] = [
    overdueProject
      ? {
          type: "timeline",
          priority: "critical",
          projectId: overdueProject.id,
          projectName: overdueProject.name,
          title: "Пересобрать график критичного проекта",
          description: "Сроки проседают относительно последнего baseline, а карта задач уже показывает зависимые блокировки.",
          action: "Закрыть новый график, владельца и ежедневный контроль следующего окна решения.",
        }
      : null,
    financeProject
      ? {
          type: "budget",
          priority: "high",
          projectId: financeProject.id,
          projectName: financeProject.name,
          title: "Снять перерасход и CAPEX drift",
          description: "Факт обгоняет план, поэтому нужен обновлённый пакет решений по бюджету и договорам.",
          action: "Подтвердить корректировку бюджета и freeze необязательных расходов до комитета.",
        }
      : null,
    resourceProject
      ? {
          type: "delivery",
          priority: "medium",
          projectId: resourceProject.id,
          projectName: resourceProject.name,
          title: "Добавить операционный owner на слабый контур",
          description: "Прогресс слишком медленный для текущего окна поставки, а команда распределена неравномерно.",
          action: "Выделить отдельного owner и зафиксировать недельный пакет действий.",
        }
      : null,
    {
      type: "governance",
      priority: "medium",
      projectId: demoDashboardState.projects[4]?.id ?? demoDashboardState.projects[0]?.id ?? "portfolio",
      projectName: demoDashboardState.projects[4]?.name ?? "Портфель",
      title: "Вынести сводки в morning brief",
      description: "Демо показывает, что план-факт, риски и evidence уже можно собрать в executive readout без ручной переписки.",
      action: "Отправить утренний brief в Telegram и почту как главный daily narrative.",
    },
  ].filter((item): item is AnalyticsRecommendation => Boolean(item));

  return {
    recommendations,
    summary: {
      total: recommendations.length,
      critical: recommendations.filter((item) => item.priority === "critical").length,
      high: recommendations.filter((item) => item.priority === "high").length,
      medium: recommendations.filter((item) => item.priority === "medium").length,
      low: recommendations.filter((item) => item.priority === "low").length,
    },
  };
}

export function getDemoTeamPerformance(): TeamPerformanceResponse {
  const members = demoDashboardState.team.map((member) => {
    const assignedTasks = demoDashboardState.tasks.filter((task) => task.assignee?.name === member.name);
    const completedTasks = assignedTasks.filter((task) => task.status === "done").length;
    const inProgressTasks = assignedTasks.filter((task) => task.status === "in-progress").length;
    const overdueTasks = assignedTasks.filter(
      (task) => task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10)
    ).length;
    const completionRate = assignedTasks.length > 0 ? Math.round((completedTasks / assignedTasks.length) * 100) : 0;
    const performanceScore = Math.max(46, Math.min(96, Math.round(completionRate * 0.65 + (100 - member.allocated) * 0.35)));

    return {
      memberId: member.id,
      memberName: member.name,
      memberInitials: member.name
        .split(" ")
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: member.role,
      performanceScore,
      metrics: {
        totalTasks: assignedTasks.length,
        completedTasks,
        inProgressTasks,
        overdueTasks,
        completionRate,
      },
      time: {
        totalHoursLogged: assignedTasks.length * 8 + inProgressTasks * 6,
        billableHours: assignedTasks.length * 6,
      },
      utilization: member.allocated,
      trend: (performanceScore >= 80 ? "up" : performanceScore >= 60 ? "stable" : "down") as "up" | "stable" | "down",
    };
  });

  return {
    summary: {
      totalMembers: members.length,
      totalTasks: members.reduce((sum, member) => sum + member.metrics.totalTasks, 0),
      totalCompleted: members.reduce((sum, member) => sum + member.metrics.completedTasks, 0),
      totalHoursLogged: members.reduce((sum, member) => sum + member.time.totalHoursLogged, 0),
      avgPerformanceScore: Math.round(
        members.reduce((sum, member) => sum + member.performanceScore, 0) /
          Math.max(members.length, 1)
      ),
    },
    members: [...members].sort((left, right) => right.performanceScore - left.performanceScore),
  };
}

function buildDemoExpenses(): ExpensesResponse["expenses"] {
  return demoDashboardState.projects.flatMap((project, projectIndex) => {
    const relevantTasks = tasksByProject.get(project.id) ?? [];
    const history = project.history.slice(-3);

    return history.map((point, historyIndex) => {
      const category = demoExpenseCategories[(projectIndex + historyIndex) % demoExpenseCategories.length];
      const previousActual = historyIndex === 0 ? Math.round(point.budgetActual * 0.72) : history[historyIndex - 1]?.budgetActual ?? 0;
      const amount = Math.max(point.budgetActual - previousActual, Math.round(project.budget.actual * 0.08));
      const relatedTask = relevantTasks[historyIndex] ?? null;
      const status = historyIndex === history.length - 1 && project.status === "at-risk" ? "pending" : "approved";

      return {
        id: `demo-expense-${project.id}-${historyIndex}`,
        projectId: project.id,
        categoryId: category.id,
        title: `${project.name} · ${category.name}`,
        description: `Демо-расход для показа план-факта и cash flow по проекту ${project.name}.`,
        amount,
        currency: project.budget.currency,
        date: point.date,
        status,
        documentUrl: null,
        supplierId: null,
        taskId: relatedTask?.id ?? null,
        equipmentId: null,
        oneCRef: `demo-1c-${project.id}-${historyIndex}`,
        project: { id: project.id, name: project.name },
        category: {
          ...category,
          icon: null,
        },
        supplier: null,
        task: relatedTask ? { id: relatedTask.id, title: relatedTask.title } : null,
        equipment: null,
      };
    });
  });
}

const demoExpenses = buildDemoExpenses();

export function getDemoExpensesResponse(projectId?: string): ExpensesResponse {
  const expenses = demoExpenses.filter((expense) => (projectId ? expense.projectId === projectId : true));

  return {
    expenses,
    summary: {
      total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
      approved: expenses
        .filter((expense) => expense.status === "approved" || expense.status === "paid")
        .reduce((sum, expense) => sum + expense.amount, 0),
      pending: expenses
        .filter((expense) => expense.status === "pending")
        .reduce((sum, expense) => sum + expense.amount, 0),
      byCategory: demoExpenseCategories
        .map((category) => ({
          categoryId: category.id,
          name: category.name,
          amount: expenses
            .filter((expense) => expense.categoryId === category.id)
            .reduce((sum, expense) => sum + expense.amount, 0),
          color: category.color,
        }))
        .filter((item) => item.amount > 0)
        .sort((left, right) => right.amount - left.amount),
    },
  };
}

export function getDemoContracts(projectId?: string) {
  const contracts: ContractView[] = demoDashboardState.projects.map((project, index) => ({
    id: `demo-contract-${project.id}`,
    number: `DC-${String(index + 1).padStart(3, "0")}`,
    title: `Контракт по проекту ${project.name}`,
    type: project.direction === "construction" ? "construction" : "services",
    supplierId: `demo-supplier-${index + 1}`,
    projectId: project.id,
    amount: Math.round(project.budget.planned * 0.68),
    paidAmount: Math.round(project.budget.actual * 0.54),
    currency: project.budget.currency,
    startDate: project.dates.start,
    endDate: project.dates.end,
    status: project.status === "completed" ? "closed" : project.status === "at-risk" ? "attention" : "active",
    documentUrl: null,
    supplier: {
      id: `demo-supplier-${index + 1}`,
      name: ["СеверТранс", "ИнжКонтур", "FieldOps Mobile", "East Storage", "HQ Signal", "Opera Build"][index] ?? `Поставщик ${index + 1}`,
    },
    project: {
      id: project.id,
      name: project.name,
    },
  }));

  return {
    contracts: contracts.filter((contract) => (projectId ? contract.projectId === projectId : true)),
  };
}

function buildDemoProjectEvm(project: Project): DemoEvmMetricPayload {
  const BAC = project.budget.planned;
  const PV = Math.max(project.history.at(-1)?.budgetPlanned ?? Math.round(BAC * 0.55), 1);
  const EV = Math.round(BAC * (project.progress / 100));
  const AC = Math.max(project.budget.actual, 1);
  const CV = EV - AC;
  const SV = EV - PV;
  const CPI = Number((EV / AC).toFixed(2));
  const SPI = Number((EV / PV).toFixed(2));
  const EAC = Math.round(BAC / Math.max(CPI, 0.01));
  const ETC = Math.max(EAC - AC, 0);
  const VAC = BAC - EAC;
  const TCPI = EAC > AC ? Number(((BAC - EV) / Math.max(EAC - AC, 1)).toFixed(2)) : null;

  return {
    BAC,
    PV,
    EV,
    AC,
    CV,
    SV,
    CPI,
    SPI,
    EAC,
    ETC,
    VAC,
    TCPI,
    TCPI_EAC: TCPI,
  };
}

export function getDemoPortfolioEvm(): DemoPortfolioEvmResponse {
  const projects = demoDashboardState.projects.map((project) => {
    const metrics = buildDemoProjectEvm(project);
    const taskCount = tasksByProject.get(project.id)?.length ?? 0;
    return {
      projectId: project.id,
      projectName: project.name,
      source: "project_budget" as const,
      metrics,
      summary: {
        taskCount,
        costedTaskCount: taskCount,
        taskBudgetCoverage: 1,
      },
    };
  });

  const metrics = projects.reduce<DemoEvmMetricPayload>(
    (accumulator, project) => ({
      BAC: accumulator.BAC + project.metrics.BAC,
      PV: accumulator.PV + project.metrics.PV,
      EV: accumulator.EV + project.metrics.EV,
      AC: accumulator.AC + project.metrics.AC,
      CV: accumulator.CV + project.metrics.CV,
      SV: accumulator.SV + project.metrics.SV,
      CPI: 0,
      SPI: 0,
      EAC: accumulator.EAC + project.metrics.EAC,
      ETC: accumulator.ETC + project.metrics.ETC,
      VAC: accumulator.VAC + project.metrics.VAC,
      TCPI: null,
      TCPI_EAC: null,
    }),
    {
      BAC: 0,
      PV: 0,
      EV: 0,
      AC: 0,
      CV: 0,
      SV: 0,
      CPI: 0,
      SPI: 0,
      EAC: 0,
      ETC: 0,
      VAC: 0,
      TCPI: null,
      TCPI_EAC: null,
    }
  );

  metrics.CPI = Number((metrics.EV / Math.max(metrics.AC, 1)).toFixed(2));
  metrics.SPI = Number((metrics.EV / Math.max(metrics.PV, 1)).toFixed(2));
  metrics.TCPI = metrics.EAC > metrics.AC
    ? Number(((metrics.BAC - metrics.EV) / Math.max(metrics.EAC - metrics.AC, 1)).toFixed(2))
    : null;
  metrics.TCPI_EAC = metrics.TCPI;

  return {
    referenceDate: new Date().toISOString(),
    metrics,
    projects,
    summary: {
      projectCount: projects.length,
      taskCount: demoDashboardState.tasks.length,
      costedTaskCount: demoDashboardState.tasks.length,
    },
  };
}

export function getDemoEvmHistory(projectId: string): DemoEvmHistoryResponse {
  const project = projectById.get(projectId);
  if (!project) {
    return { projectId, snapshots: [] };
  }

  return {
    projectId,
    snapshots: project.history.map((point, index) => {
      const bac = project.budget.planned;
      const pv = point.budgetPlanned;
      const ev = Math.round(bac * (point.progress / 100));
      const ac = point.budgetActual;
      const cpi = ac > 0 ? Number((ev / ac).toFixed(2)) : null;
      const spi = pv > 0 ? Number((ev / pv).toFixed(2)) : null;
      const eac = cpi && cpi > 0 ? Math.round(bac / cpi) : null;
      const tcpi = eac && eac > ac ? Number(((bac - ev) / Math.max(eac - ac, 1)).toFixed(2)) : null;

      return {
        id: `demo-evm-history-${projectId}-${index}`,
        date: point.date,
        bac,
        pv,
        ev,
        ac,
        cpi,
        spi,
        eac,
        tcpi,
      };
    }),
  };
}

export function getDemoProjectsFinanceResponse(): DemoProjectsFinanceResponse {
  return {
    projects: demoDashboardState.projects.map((project) => ({
      id: project.id,
      name: project.name,
      start: project.dates.start,
      end: project.dates.end,
      budgetPlan: project.budget.planned,
      budgetFact: project.budget.actual,
    })),
  };
}

export function getDemoExecutiveSnapshot(): ExecutiveSnapshot {
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    projects: demoDashboardState.projects.map((project) => ({
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
        currency: project.budget.currency,
      },
      dates: {
        start: project.dates.start,
        end: project.dates.end,
      },
      nextMilestone: project.nextMilestone,
      history: project.history,
    })),
    tasks: demoDashboardState.tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      completedAt: task.status === "done" ? task.dueDate : null,
      assigneeId: task.assignee?.id ?? null,
      assigneeName: task.assignee?.name ?? null,
    })),
    risks: demoDashboardState.risks.map((risk) => ({
      id: risk.id,
      projectId: risk.projectId,
      title: risk.title,
      status: risk.status,
      severity: risk.probability * risk.impact,
      probability: risk.probability / 5,
      impact: risk.impact / 5,
      mitigation: risk.mitigation,
      owner: risk.owner,
      createdAt: projectById.get(risk.projectId)?.dates.start ?? generatedAt,
      updatedAt: projectById.get(risk.projectId)?.history.at(-1)?.date ?? generatedAt,
    })),
    milestones: demoDashboardState.projects
      .filter((project) => project.nextMilestone)
      .map((project) => ({
        id: `demo-exec-milestone-${project.id}`,
        projectId: project.id,
        title: project.nextMilestone!.name,
        date: project.nextMilestone!.date,
        status: project.status === "completed" ? "completed" : project.status === "at-risk" ? "overdue" : "upcoming",
        updatedAt: project.history.at(-1)?.date ?? generatedAt,
      })),
    workReports: demoDashboardState.projects
      .filter((project) => project.status !== "planning")
      .flatMap((project, index) => {
        const approvedAt = shiftIsoDate(generatedAt, -(index + 1));
        const submittedAt = shiftIsoDate(generatedAt, -(index + 3));

        return [
          {
            id: `demo-report-${project.id}-approved`,
            projectId: project.id,
            reportNumber: `DEMO-${project.id.toUpperCase()}-01`,
            reportDate: approvedAt,
            status: "approved",
            source: "demo",
            authorId: `demo-author-${project.id}`,
            reviewerId: `demo-reviewer-${project.id}`,
            submittedAt: approvedAt,
            reviewedAt: approvedAt,
          },
          ...(project.status === "at-risk"
            ? [
                {
                  id: `demo-report-${project.id}-submitted`,
                  projectId: project.id,
                  reportNumber: `DEMO-${project.id.toUpperCase()}-02`,
                  reportDate: submittedAt,
                  status: "submitted",
                  source: "demo",
                  authorId: `demo-author-${project.id}`,
                  reviewerId: null,
                  submittedAt,
                  reviewedAt: null,
                },
              ]
            : []),
        ];
      }),
    teamMembers: demoDashboardState.team.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      capacity: member.capacity,
      allocated: member.allocated,
      projectIds: member.projects,
    })),
  };
}

export function getDemoKnowledgeLoop(): KnowledgeLoopOverview {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPlaybooks: 3,
      repeatedPlaybooks: 2,
      benchmarkedGuidance: 3,
      trackedPatterns: 3,
    },
    playbooks: [
      {
        id: "demo-playbook-budget",
        title: "CAPEX drift escalation",
        patternKey: "budget_drift",
        proposalType: "draft_status_report",
        purpose: "Остановить перерасход до комитета",
        maturity: "repeated",
        totalOccurrences: 4,
        openOccurrences: 1,
        resolvedOccurrences: 3,
        benchmark: {
          ownerRole: "Финансовый контролер",
          ackTargetHours: 6,
          resolutionRate: 0.75,
          breachRate: 0.12,
          source: "observed_history",
        },
        mutationSurface: "workspace",
        compensationMode: "follow_up_patch",
        guidance: "Подтвердить owner, финмодель и freeze необязательных расходов в одном решении.",
        lessons: ["Сначала финмодель, потом согласование.", "Без owner эскалация зависает на сутки."],
      },
      {
        id: "demo-playbook-delivery",
        title: "Schedule recovery packet",
        patternKey: "schedule_recovery",
        proposalType: "draft_status_report",
        purpose: "Вернуть delivery rhythm",
        maturity: "repeated",
        totalOccurrences: 5,
        openOccurrences: 1,
        resolvedOccurrences: 4,
        benchmark: {
          ownerRole: "Руководитель проекта",
          ackTargetHours: 4,
          resolutionRate: 0.8,
          breachRate: 0.08,
          source: "observed_history",
        },
        mutationSurface: "workspace",
        compensationMode: "follow_up_patch",
        guidance: "У recovery-пакета должен быть один следующий шаг и один владелец.",
        lessons: ["Переплан без owner не срабатывает.", "Лучше weekly packet, чем длинный протокол."],
      },
      {
        id: "demo-playbook-evidence",
        title: "Morning brief with evidence",
        patternKey: "evidence_brief",
        proposalType: "draft_status_report",
        purpose: "Объяснить решение фактами",
        maturity: "emerging",
        totalOccurrences: 2,
        openOccurrences: 0,
        resolvedOccurrences: 2,
        benchmark: {
          ownerRole: "Operations lead",
          ackTargetHours: 8,
          resolutionRate: 1,
          breachRate: 0,
          source: "sla_window",
        },
        mutationSurface: "workspace",
        compensationMode: "follow_up_patch",
        guidance: "Каждая утренняя сводка должна завершаться next action, а не только risk list.",
        lessons: ["Decision layer ценнее raw dashboard.", "Evidence лучше работает рядом с budget variance."],
      },
    ],
    activeGuidance: [
      {
        escalationId: "demo-esc-1",
        projectName: demoDashboardState.projects[1]?.name ?? null,
        title: "Кампус: перерасход по инженерному блоку",
        urgency: "high",
        queueStatus: "open",
        playbookId: "demo-playbook-budget",
        playbookTitle: "CAPEX drift escalation",
        benchmarkSummary: "Финансовый owner отвечает за 6 часов, типовое решение закрывается за день.",
        recommendedAction: "Подтвердить owner и вынести CAPEX update в ближайший brief.",
      },
    ],
  };
}

export function getDemoBriefDeliveryLedger(): BriefDeliveryLedgerRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: "demo-ledger-1",
      channel: "telegram",
      provider: "demo-preview",
      mode: "scheduled",
      scope: "portfolio",
      projectId: null,
      projectName: null,
      locale: "ru",
      target: "@hq_demo",
      headline: "Утренний brief по портфелю",
      idempotencyKey: "demo:brief:portfolio:morning",
      scheduledPolicyId: "demo-morning",
      status: "delivered",
      retryPosture: "sealed",
      attemptCount: 1,
      dryRun: false,
      providerMessageId: "demo-tg-001",
      contentHash: "demo-hash-001",
      lastError: null,
      firstAttemptAt: now,
      lastAttemptAt: now,
      deliveredAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-ledger-2",
      channel: "email",
      provider: "demo-preview",
      mode: "manual",
      scope: "project",
      projectId: demoDashboardState.projects[0]?.id ?? null,
      projectName: demoDashboardState.projects[0]?.name ?? null,
      locale: "ru",
      target: "ops-demo@ceoclaw.app",
      headline: "Project brief: Северный логистический коридор",
      idempotencyKey: "demo:brief:project:north",
      scheduledPolicyId: null,
      status: "preview",
      retryPosture: "preview_only",
      attemptCount: 1,
      dryRun: true,
      providerMessageId: null,
      contentHash: "demo-hash-002",
      lastError: null,
      firstAttemptAt: now,
      lastAttemptAt: now,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function getDemoGpsTelemetry(): GpsTelemetryTruthSnapshot {
  const checkedAt = new Date().toISOString();
  return {
    id: "gps",
    checkedAt,
    configured: true,
    status: "ok",
    message: "Demo GPS telemetry is synthesized for the public workspace.",
    missingSecrets: [],
    sampleUrl: "/demo/workspace/field-operations",
    samples: [
      {
        source: "gps",
        sessionId: "demo-session-1",
        equipmentId: "truck-north-1",
        equipmentType: "truck",
        status: "work",
        startedAt: shiftIsoDate(checkedAt, -1),
        endedAt: null,
        durationSeconds: 5400,
        geofenceId: "geo-surgut-yard",
        geofenceName: "Сургут: логистический двор",
      },
      {
        source: "gps",
        sessionId: "demo-session-2",
        equipmentId: "excavator-campus-1",
        equipmentType: "excavator",
        status: "idle",
        startedAt: shiftIsoDate(checkedAt, -1),
        endedAt: shiftIsoDate(checkedAt, -1),
        durationSeconds: 3600,
        geofenceId: "geo-tyumen-campus",
        geofenceName: "Тюмень: кампус",
      },
    ],
    summary: {
      sessionCount: 2,
      equipmentCount: 2,
      geofenceCount: 2,
      totalDurationSeconds: 9000,
      openEndedSessionCount: 1,
      equipmentLinkedSessions: 2,
      geofenceLinkedSessions: 2,
    },
    sessions: [
      {
        source: "gps",
        sessionId: "demo-session-1",
        equipmentId: "truck-north-1",
        equipmentType: "truck",
        status: "work",
        startedAt: shiftIsoDate(checkedAt, -1),
        endedAt: null,
        durationSeconds: 5400,
        geofenceId: "geo-surgut-yard",
        geofenceName: "Сургут: логистический двор",
        sessionKey: "demo-session-1",
        equipmentKey: "truck-north-1",
        geofenceKey: "geo-surgut-yard",
        observedAt: checkedAt,
        hasOpenEndedRange: true,
      },
      {
        source: "gps",
        sessionId: "demo-session-2",
        equipmentId: "excavator-campus-1",
        equipmentType: "excavator",
        status: "idle",
        startedAt: shiftIsoDate(checkedAt, -1),
        endedAt: shiftIsoDate(checkedAt, -1),
        durationSeconds: 3600,
        geofenceId: "geo-tyumen-campus",
        geofenceName: "Тюмень: кампус",
        sessionKey: "demo-session-2",
        equipmentKey: "excavator-campus-1",
        geofenceKey: "geo-tyumen-campus",
        observedAt: checkedAt,
        hasOpenEndedRange: false,
      },
    ],
    equipment: [
      {
        equipmentKey: "truck-north-1",
        equipmentId: "truck-north-1",
        equipmentType: "truck",
        sessionCount: 1,
        totalDurationSeconds: 5400,
        latestObservedAt: checkedAt,
        latestStatus: "work",
        latestGeofenceKey: "geo-surgut-yard",
        latestGeofenceName: "Сургут: логистический двор",
      },
      {
        equipmentKey: "excavator-campus-1",
        equipmentId: "excavator-campus-1",
        equipmentType: "excavator",
        sessionCount: 1,
        totalDurationSeconds: 3600,
        latestObservedAt: checkedAt,
        latestStatus: "idle",
        latestGeofenceKey: "geo-tyumen-campus",
        latestGeofenceName: "Тюмень: кампус",
      },
    ],
    geofences: [
      {
        geofenceKey: "geo-surgut-yard",
        geofenceId: "geo-surgut-yard",
        geofenceName: "Сургут: логистический двор",
        sessionCount: 1,
        equipmentCount: 1,
        totalDurationSeconds: 5400,
        latestObservedAt: checkedAt,
        equipmentIds: ["truck-north-1"],
      },
      {
        geofenceKey: "geo-tyumen-campus",
        geofenceId: "geo-tyumen-campus",
        geofenceName: "Тюмень: кампус",
        sessionCount: 1,
        equipmentCount: 1,
        totalDurationSeconds: 3600,
        latestObservedAt: checkedAt,
        equipmentIds: ["excavator-campus-1"],
      },
    ],
    metadata: {
      mode: "demo",
    },
  };
}

export function getDemoVideoFacts(): VideoFactListResult {
  const capturedAt = new Date().toISOString();
  return {
    syncedAt: capturedAt,
    summary: {
      total: 2,
      observed: 1,
      verified: 1,
      averageConfidence: 0.84,
      lastCapturedAt: capturedAt,
    },
    items: [
      {
        id: "demo-video-fact-1",
        documentId: "demo-doc-1",
        reportId: "demo-report-p1-approved",
        reportNumber: "DEMO-P1-01",
        reportStatus: "approved",
        projectId: demoDashboardState.projects[0]?.id ?? null,
        projectName: demoDashboardState.projects[0]?.name ?? null,
        section: "Северный участок",
        title: "Подтверждён коридор разгрузки",
        summary: "Видео подтверждает готовность площадки к следующему плечу поставки.",
        url: null,
        mimeType: "video/mp4",
        size: 15_000_000,
        observationType: "progress_visible",
        capturedAt,
        reportedAt: capturedAt,
        confidence: 0.91,
        verificationStatus: "verified",
        verificationRule: "demo_evidence_alignment",
      },
      {
        id: "demo-video-fact-2",
        documentId: "demo-doc-2",
        reportId: "demo-report-p2-submitted",
        reportNumber: "DEMO-P2-02",
        reportStatus: "submitted",
        projectId: demoDashboardState.projects[1]?.id ?? null,
        projectName: demoDashboardState.projects[1]?.name ?? null,
        section: "Кампус",
        title: "Инженерный блок ждёт подтверждения",
        summary: "Фотофиксация показывает незавершённый инженерный блок и pending packet на согласование.",
        url: null,
        mimeType: "image/jpeg",
        size: 4_500_000,
        observationType: "blocked_area",
        capturedAt: shiftIsoDate(capturedAt, -1),
        reportedAt: shiftIsoDate(capturedAt, -1),
        confidence: 0.77,
        verificationStatus: "observed",
        verificationRule: "demo_pending_review",
      },
    ],
  };
}

export function getDemoEnterpriseTruth(): EnterpriseTruthOverview {
  const generatedAt = new Date().toISOString();
  return {
    syncedAt: generatedAt,
    summary: {
      totalProjects: demoDashboardState.projects.length,
      corroborated: 4,
      fieldOnly: 1,
      financeOnly: 1,
      telemetryGaps: 2,
      largestVarianceProject: demoDashboardState.projects[1]?.name ?? null,
    },
    projects: demoDashboardState.projects.slice(0, 4).map((project, idx) => {
      const variance = project.budget.actual - project.budget.planned;
      const variancePercent = project.budget.planned > 0 ? variance / project.budget.planned : null;
      const isAtRisk = project.status === "at-risk";
      const status = (isAtRisk ? "field_only" : idx === 0 ? "finance_only" : "corroborated") as
        "corroborated" | "field_only" | "finance_only";
      return {
        id: `demo-truth-${project.id}`,
        projectId: project.id,
        projectName: project.name,
        financeProjectId: null,
        status,
        finance: {
          sample: null,
          variance,
          variancePercent,
          reportDate: project.history.at(-1)?.date ?? null,
        },
        field: {
          reportCount: project.status === "planning" ? 2 : 8,
          fusedFactCount: project.location ? 4 : 1,
          strongestVerificationStatus: (project.location ? "verified" : "reported") as
            "reported" | "observed" | "verified" | "none",
          latestObservedAt: project.history.at(-1)?.date ?? null,
        },
        explanation: isAtRisk
          ? "Полевые отчёты есть, финансовое подтверждение неполное."
          : "Данные по полю и финансам согласованы.",
      };
    }),
    telemetryGaps: [
      {
        id: "demo-gap-1",
        equipmentId: null,
        geofenceName: demoDashboardState.projects[1]?.name ?? "Инженерный блок",
        observedAt: shiftIsoDate(generatedAt, -2),
        confidence: 0.4,
        explanation: "Телеметрия не обновлялась после последнего work report.",
      },
      {
        id: "demo-gap-2",
        equipmentId: null,
        geofenceName: demoDashboardState.projects[5]?.name ?? "Участок реконструкции",
        observedAt: shiftIsoDate(generatedAt, -3),
        confidence: 0.3,
        explanation: "Фотофакты не покрывают новый участок реконструкции.",
      },
    ],
  };
}

export function getDemoEscalationQueue(): EscalationListResult {
  const now = new Date().toISOString();
  return {
    syncedAt: now,
    summary: {
      total: 2,
      open: 1,
      acknowledged: 1,
      resolved: 0,
      critical: 1,
      high: 1,
      dueSoon: 1,
      breached: 0,
      unassigned: 0,
    },
    items: [
      {
        id: "demo-escalation-1",
        sourceType: "demo_alert",
        sourceRef: "budget-drift",
        entityType: "project",
        entityRef: demoDashboardState.projects[1]?.id ?? "p2",
        projectId: demoDashboardState.projects[1]?.id ?? "p2",
        projectName: demoDashboardState.projects[1]?.name ?? null,
        title: "Перерасход по инженерному блоку",
        summary: "Факт вышел за baseline CAPEX и требует owner-level решения.",
        purpose: "Снять drift до комитета",
        urgency: "critical",
        queueStatus: "open",
        sourceStatus: "needs_approval",
        owner: {
          id: demoDashboardState.team[1]?.id ?? "m2",
          name: demoDashboardState.team[1]?.name ?? "Owner",
          role: demoDashboardState.team[1]?.role ?? null,
        },
        recommendedOwnerRole: "Финансовый контролер",
        firstObservedAt: shiftIsoDate(now, -1),
        lastObservedAt: now,
        acknowledgedAt: null,
        resolvedAt: null,
        slaTargetAt: shiftIsoDate(now, 1),
        slaState: "due_soon",
        ageHours: 18,
        metadata: {
          packetLabel: "CAPEX recovery packet",
          proposalType: "draft_status_report",
          purposeLabel: "Budget recovery",
        },
      },
      {
        id: "demo-escalation-2",
        sourceType: "demo_alert",
        sourceRef: "schedule-recovery",
        entityType: "project",
        entityRef: demoDashboardState.projects[5]?.id ?? "p6",
        projectId: demoDashboardState.projects[5]?.id ?? "p6",
        projectName: demoDashboardState.projects[5]?.name ?? null,
        title: "Нужен recovery packet по реконструкции",
        summary: "Следующее окно решения не закреплено owner'ом.",
        purpose: "Вернуть delivery rhythm",
        urgency: "high",
        queueStatus: "acknowledged",
        sourceStatus: "running",
        owner: {
          id: demoDashboardState.team[0]?.id ?? "m1",
          name: demoDashboardState.team[0]?.name ?? "Owner",
          role: demoDashboardState.team[0]?.role ?? null,
        },
        recommendedOwnerRole: "Руководитель проекта",
        firstObservedAt: shiftIsoDate(now, -2),
        lastObservedAt: now,
        acknowledgedAt: shiftIsoDate(now, -1),
        resolvedAt: null,
        slaTargetAt: shiftIsoDate(now, 1),
        slaState: "on_track",
        ageHours: 29,
        metadata: {
          packetLabel: "Schedule recovery packet",
          proposalType: "draft_status_report",
          purposeLabel: "Delivery recovery",
        },
      },
    ],
    sync: null,
  };
}

export function getDemoWorkReports(): WorkReportView[] {
  const now = new Date().toISOString();
  return demoDashboardState.projects.slice(0, 4).map((project, index) => {
    const isAtRisk = project.status === "at-risk";
    const authorName = project.team[0] ?? "Demo owner";
    const reportStatus = isAtRisk ? "submitted" : "approved";
    const reviewerId = isAtRisk ? null : `demo-reviewer-${project.id}`;
    const reviewerName = isAtRisk ? null : "HQ reviewer";
    return {
      id: `demo-work-report-${project.id}`,
      reportNumber: `WR-${project.id.toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
      projectId: project.id,
      project: { id: project.id, name: project.name },
      authorId: `demo-author-${project.id}`,
      author: { id: `demo-author-${project.id}`, name: authorName, role: "Руководитель работ", initials: authorName.slice(0, 2).toUpperCase() },
      reviewerId,
      reviewer: reviewerId ? { id: reviewerId, name: reviewerName ?? "HQ reviewer", role: "Контролёр", initials: "HR" } : null,
      section: project.name,
      reportDate: shiftIsoDate(now, -(index + 1)),
      workDescription: `${project.name}: выполнены плановые работы по проекту. Прогресс ${project.progress}%.`,
      volumes: [],
      personnelCount: 8 + index,
      personnelDetails: null,
      equipment: null,
      weather: null,
      issues: isAtRisk ? "Зафиксирован перерасход бюджета. Требуется решение владельца." : null,
      nextDayPlan: "Продолжить по плану, актуализировать трекер задач.",
      attachments: [],
      status: reportStatus,
      reviewComment: null,
      source: "manual",
      externalReporterTelegramId: null,
      externalReporterName: null,
      submittedAt: shiftIsoDate(now, -(index + 1)),
      reviewedAt: isAtRisk ? null : shiftIsoDate(now, -index),
      createdAt: shiftIsoDate(now, -(index + 1)),
      updatedAt: shiftIsoDate(now, -index),
    };
  });
}
