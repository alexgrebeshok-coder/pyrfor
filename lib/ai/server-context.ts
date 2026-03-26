import { assembleContext } from "@/lib/ai/context-assembler";
import { buildDashboardStateFromExecutiveSnapshot } from "@/lib/ai/context-snapshot-adapter";
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
  const assembled = await assembleContext({
    projectId: options.projectId,
    locale: options.locale,
    interfaceLocale: options.interfaceLocale,
    includeEvidence: false,
    includeMemory: false,
  });
  const state = buildDashboardStateFromExecutiveSnapshot(assembled.snapshot);
  const activeContext = resolveServerAIContextRef(state, options);
  const project = activeContext.projectId
    ? state.projects.find((item) => item.id === activeContext.projectId)
    : undefined;

  return {
    locale: options.locale ?? "ru",
    interfaceLocale: options.interfaceLocale ?? options.locale ?? "ru",
    generatedAt: assembled.generatedAt,
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

  const assembled = await assembleContext({
    includeEvidence: false,
    includeMemory: false,
  });

  return buildDashboardStateFromExecutiveSnapshot(assembled.snapshot);
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
