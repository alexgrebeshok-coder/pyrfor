import { addDays, format, parseISO } from "date-fns";

import { useLocale } from "@/contexts/locale-context";
import { APIError } from "@/lib/client/api-error";
import { getTodayIsoDate } from "@/lib/date";
import type {
  DashboardState,
  NotificationItem,
  Project,
  ProjectFormValues,
  Task,
} from "@/lib/types";
import { getRiskSeverity } from "@/lib/utils";

import type { AddTaskPayload, DashboardCachePayload } from "@/components/dashboard-provider.types";

const CACHE_KEY = "ceoclaw_cache";
const LEGACY_STORAGE_KEY = "pm-dashboard-state-v1";

export const emptyDashboardState: DashboardState = {
  projects: [],
  tasks: [],
  team: [],
  risks: [],
  documents: [],
  milestones: [],
  currentUser: {
    id: "user-1",
    name: "Саша",
    role: "PM",
    email: "alex@example.com",
  },
  auditLogEntries: [],
};

export function isExpectedDashboardLoadError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.code === "DATABASE_SCHEMA_UNAVAILABLE" ||
      error.code === "DATABASE_CONNECTION_UNAVAILABLE")
  );
}

export function readCachedState(): DashboardState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as DashboardCachePayload;
    if ("state" in parsed) {
      return parsed.state;
    }

    return parsed;
  } catch (error) {
    console.error("Failed to read dashboard cache", error);
    return null;
  }
}

export function writeCachedState(state: DashboardState) {
  const payload = JSON.stringify({
    state,
    timestamp: Date.now(),
  });
  localStorage.setItem(CACHE_KEY, payload);
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state));
}

let writeCacheTimer: ReturnType<typeof setTimeout> | null = null;
export function writeCachedStateDebounced(state: DashboardState, delay = 500) {
  if (writeCacheTimer) {
    clearTimeout(writeCacheTimer);
  }
  writeCacheTimer = setTimeout(() => {
    writeCachedState(state);
    writeCacheTimer = null;
  }, delay);
}

export function createOptimisticProject(values: ProjectFormValues, id: string): Project {
  const today = new Date();
  const startDate = parseISO(values.start);
  const progressSeed = Math.max(values.progress, 5);

  return {
    id,
    name: values.name,
    description: values.description,
    status: values.status,
    progress: values.progress,
    direction: values.direction,
    budget: {
      planned: values.plannedBudget,
      actual: values.actualBudget,
      currency: values.currency || "RUB",
    },
    dates: { start: values.start, end: values.end },
    nextMilestone: {
      name: "Kickoff board",
      date: format(addDays(startDate, 21), "yyyy-MM-dd"),
    },
    team: values.team,
    risks: 0,
    location: values.location,
    priority: values.priority,
    health: values.status === "at-risk" ? 52 : 76,
    objectives: [
      "Сформировать операционный baseline.",
      "Подтвердить ближайшие milestone и зависимости.",
      "Подготовить пакет управленческих действий на следующий цикл.",
    ],
    materials: 48,
    laborProductivity: 70,
    safety: { ltifr: 0.2, trir: 0.6 },
    history: [
      {
        date: format(startDate, "yyyy-MM-dd"),
        progress: Math.max(progressSeed - 12, 0),
        budgetPlanned: Math.round(values.plannedBudget * 0.12),
        budgetActual: Math.round(values.actualBudget * 0.2),
      },
      {
        date: format(today, "yyyy-MM-dd"),
        progress: values.progress,
        budgetPlanned: Math.round(values.plannedBudget * 0.3),
        budgetActual: values.actualBudget,
      },
    ],
  };
}

export function createOptimisticTask(payload: AddTaskPayload, id: string, fallbackOrder = 0): Task {
  return {
    id,
    projectId: payload.projectId,
    title: payload.title,
    description: payload.description ?? "Quick action task",
    status: payload.status ?? "todo",
    order: payload.order ?? fallbackOrder,
    assignee: payload.assignee
      ? {
          id: `temp-${Date.now()}`,
          name: payload.assignee,
          initials: payload.assignee
            .split(" ")
            .map((part) => part[0])
            .join("")
            .toUpperCase(),
        }
      : null,
    dueDate: payload.dueDate,
    priority: payload.priority ?? "medium",
    tags: payload.tags?.length ? payload.tags : ["quick-action"],
    createdAt: format(new Date(), "yyyy-MM-dd"),
  };
}

export function buildNotifications(
  state: DashboardState,
  t: ReturnType<typeof useLocale>["t"]
): NotificationItem[] {
  const today = getTodayIsoDate();

  const projectAlerts: NotificationItem[] = state.projects
    .filter((project) => project.status === "at-risk")
    .map((project) => ({
      id: `project-${project.id}`,
      title: t("notification.projectFocusTitle", { name: project.name }),
      description: t("notification.projectFocusDesc", { health: project.health }),
      severity: "critical",
      createdAt: project.nextMilestone?.date ?? project.dates.end,
      projectId: project.id,
    }));

  const overdueTasks: NotificationItem[] = state.tasks
    .filter((task) => task.status !== "done" && task.dueDate <= today)
    .map((task) => ({
      id: `task-${task.id}`,
      title: t("notification.overdueTitle", { name: task.title }),
      description: t("notification.overdueDesc", {
        assignee: task.assignee?.name || "Unassigned",
      }),
      severity: task.priority === "critical" ? "critical" : "warning",
      createdAt: task.dueDate,
      projectId: task.projectId,
    }));

  const riskAlerts: NotificationItem[] = state.risks
    .filter((risk) => risk.status === "open")
    .filter((risk) => getRiskSeverity(risk.probability, risk.impact) !== "info")
    .map((risk) => ({
      id: `risk-${risk.id}`,
      title: t("notification.riskTitle", { name: risk.title }),
      description: t("notification.riskDesc", {
        owner: risk.owner,
        score: `${risk.probability}×${risk.impact}`,
      }),
      severity: getRiskSeverity(risk.probability, risk.impact),
      createdAt: today,
      projectId: risk.projectId,
    }));

  return [...projectAlerts, ...overdueTasks, ...riskAlerts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
}
