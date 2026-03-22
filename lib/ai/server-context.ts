import { prisma } from "@/lib/prisma";
import {
  buildDashboardStateFromApi,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
  type ApiTeamMember,
} from "@/lib/client/normalizers";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import type { Locale } from "@/lib/translations";
import type { DashboardState } from "@/lib/types";

import type { AIContextRef, AIContextSnapshot } from "./types";

interface ServerAIContextOptions {
  interfaceLocale?: Locale;
  locale?: Locale;
  pathname?: string;
  projectId?: string;
  subtitle?: string;
  title?: string;
}

export async function loadServerAIContext(
  options: ServerAIContextOptions = {}
): Promise<AIContextSnapshot> {
  const state = await loadServerDashboardState();
  const activeContext = resolveServerAIContextRef(state, options);
  const project = activeContext.projectId
    ? state.projects.find((item) => item.id === activeContext.projectId)
    : undefined;

  return {
    locale: options.locale ?? "ru",
    interfaceLocale: options.interfaceLocale ?? options.locale ?? "ru",
    generatedAt: new Date().toISOString(),
    activeContext,
    projects: state.projects,
    tasks: state.tasks,
    team: state.team,
    risks: state.risks,
    notifications: [],
    project,
    projectTasks: project
      ? state.tasks.filter((task) => task.projectId === project.id)
      : undefined,
  };
}

export async function loadServerDashboardState(): Promise<DashboardState> {
  const runtime = getServerRuntimeState();

  if (!runtime.databaseConfigured) {
    throw new Error("DATABASE_URL is not configured for live mode.");
  }

  const [rawProjects, rawTasks, rawTeam, rawRisks] = await Promise.all([
    prisma.project.findMany({
      include: {
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: [{ order: "asc" }, { dueDate: "asc" }],
        },
        team: {
          orderBy: { name: "asc" },
        },
        risks: {
          orderBy: { severity: "desc" },
        },
        milestones: {
          orderBy: { date: "asc" },
        },
        documents: {
          include: {
            owner: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.findMany({
      include: {
        assignee: {
          select: { id: true, name: true, initials: true },
        },
      },
      orderBy: [{ order: "asc" }, { dueDate: "asc" }],
    }),
    prisma.teamMember.findMany({
      include: {
        tasks: {
          where: {
            status: {
              notIn: ["done", "cancelled"],
            },
          },
          orderBy: { dueDate: "asc" },
        },
        projects: {
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.risk.findMany({
      include: {
        owner: {
          select: { id: true, name: true, initials: true },
        },
      },
      orderBy: { severity: "desc" },
    }),
  ]);

  const projects = rawProjects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => ({
      ...task,
      assignee: task.assignee ?? null,
    })),
    team: project.team,
    risks: project.risks,
    milestones: project.milestones,
    documents: project.documents.map((document) => ({
      ...document,
      owner: document.owner ?? null,
    })),
  }));

  const tasks = rawTasks.map((task) => ({
    ...task,
    assignee: task.assignee ?? null,
  }));

  const team = rawTeam.map((member) => ({
    ...member,
    tasks: member.tasks,
    projects: member.projects,
  }));

  const risks = rawRisks.map((risk) => ({
    ...risk,
    owner: risk.owner ?? null,
  }));

  return buildDashboardStateFromApi({
    projects: projects as unknown as ApiProject[],
    tasks: tasks as unknown as ApiTask[],
    team: team as unknown as ApiTeamMember[],
    risks: risks as unknown as ApiRisk[],
  });
}

function resolveServerAIContextRef(
  state: DashboardState,
  options: ServerAIContextOptions
): AIContextRef {
  if (options.projectId) {
    const project = state.projects.find((item) => item.id === options.projectId);
    if (!project) {
      throw new Error(`Project "${options.projectId}" was not found.`);
    }

    return {
      type: "project",
      pathname: options.pathname ?? `/projects/${project.id}`,
      title: options.title ?? project.name,
      subtitle:
        options.subtitle ??
        project.description ??
        "Meeting-to-action context for the selected project.",
      projectId: project.id,
    };
  }

  return {
    type: "portfolio",
    pathname: options.pathname ?? "/meetings",
    title: options.title ?? "Portfolio meeting intake",
    subtitle:
      options.subtitle ??
      "Meeting-to-action context across the full portfolio.",
  };
}
