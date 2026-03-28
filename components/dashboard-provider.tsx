"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { addDays, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { usePathname } from "next/navigation";

import { useLocale } from "@/contexts/locale-context";
import { APIError, api } from "@/lib/client/api-error";
import {
  buildDashboardStateFromApi,
  denormalizeProjectStatus,
  denormalizeTaskStatus,
  type ApiDocument,
  type ApiMilestone,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
  type ApiTeamMember,
} from "@/lib/client/normalizers";
import { demoDashboardState } from "@/lib/demo/workspace-data";
import { isDemoWorkspacePath } from "@/lib/demo/workspace-paths";
import { getTodayIsoDate } from "@/lib/date";
import { revalidateAll } from "@/lib/hooks/use-api";
import { isPublicAppPath } from "@/lib/public-paths";
import {
  DashboardState,
  NotificationItem,
  Priority,
  Project,
  ProjectFormValues,
  ProjectStatus,
  Task,
  TaskStatus,
} from "@/lib/types";
import { getRiskSeverity } from "@/lib/utils";

const CACHE_KEY = "ceoclaw_cache";
const LEGACY_STORAGE_KEY = "pm-dashboard-state-v1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const emptyDashboardState: DashboardState = {
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

export interface AddTaskPayload {
  projectId: string;
  title: string;
  assignee: string;
  dueDate: string;
  description?: string;
  priority?: Priority;
  status?: TaskStatus;
  order?: number;
  tags?: string[];
}

interface DashboardContextValue extends DashboardState {
  isHydrating: boolean;
  isLoading: boolean;
  error: string | null;
  isDegradedMode: boolean;
  notifications: NotificationItem[];
  retry: () => void;
  addProject: (values: ProjectFormValues) => Promise<void>;
  updateProject: (projectId: string, values: ProjectFormValues) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  duplicateProject: (projectId: string) => Promise<void>;
  addTask: (payload: AddTaskPayload) => Promise<void>;
  addTasksBatch: (payloads: AddTaskPayload[]) => Promise<void>;
  updateTaskStatus: (taskIds: string[], status: TaskStatus) => Promise<void>;
  reorderKanbanTasks: (
    projectId: string,
    nextColumns: Partial<Record<TaskStatus, string[]>>
  ) => Promise<void>;
  setProjectStatus: (projectId: string, status: ProjectStatus) => Promise<void>;
}

type DashboardCachePayload =
  | DashboardState
  | {
      state: DashboardState;
      timestamp?: number;
    };

const DashboardContext = createContext<DashboardContextValue | null>(null);
export { DashboardContext };

function isExpectedDashboardLoadError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.code === "DATABASE_SCHEMA_UNAVAILABLE" ||
      error.code === "DATABASE_CONNECTION_UNAVAILABLE")
  );
}

function readCachedState(): DashboardState | null {
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

function writeCachedState(state: DashboardState) {
  const payload = JSON.stringify({
    state,
    timestamp: Date.now(),
  });
  localStorage.setItem(CACHE_KEY, payload);
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state));
}

// P3-2: Debounced version to avoid excessive localStorage writes
let writeCacheTimer: ReturnType<typeof setTimeout> | null = null;
function writeCachedStateDebounced(state: DashboardState, delay = 500) {
  if (writeCacheTimer) {
    clearTimeout(writeCacheTimer);
  }
  writeCacheTimer = setTimeout(() => {
    writeCachedState(state);
    writeCacheTimer = null;
  }, delay);
}

function createOptimisticProject(values: ProjectFormValues, id: string): Project {
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

function createOptimisticTask(payload: AddTaskPayload, id: string, fallbackOrder = 0): Task {
  return {
    id,
    projectId: payload.projectId,
    title: payload.title,
    description: payload.description ?? "Quick action task",
    status: payload.status ?? "todo",
    order: payload.order ?? fallbackOrder,
    assignee: payload.assignee ? {
      id: `temp-${Date.now()}`,
      name: payload.assignee,
      initials: payload.assignee.split(" ").map(n => n[0]).join("").toUpperCase(),
    } : null,
    dueDate: payload.dueDate,
    priority: payload.priority ?? "medium",
    tags: payload.tags?.length ? payload.tags : ["quick-action"],
    createdAt: format(new Date(), "yyyy-MM-dd"),
  };
}

function buildNotifications(
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
      description: t("notification.overdueDesc", { assignee: task.assignee?.name || "Unassigned" }),
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

export function DashboardProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isPublicPage = isPublicAppPath(pathname);
  const isDemoWorkspace = isDemoWorkspacePath(pathname);
  const { enumLabel, t } = useLocale();
  const [state, setState] = useState<DashboardState>(
    isDemoWorkspace ? demoDashboardState : emptyDashboardState
  );
  const [isLoading, setIsLoading] = useState(!isPublicPage && !isDemoWorkspace);
  const [error, setError] = useState<string | null>(null);
  // P3-2: Track degraded mode (using cached/mock data)
  const [isDegradedMode, setIsDegradedMode] = useState(false);

  const loadDashboardData = useCallback(async (options?: { silent?: boolean }) => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return demoDashboardState;
    }

    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      setError(null);

      const [projectsRes, tasksRes, teamRes, risksRes] = await Promise.all([
        api.get<{ projects: ApiProject[] }>(
          "/api/projects?includeTeam=true&includeRisks=true&includeMilestones=true&includeDocuments=true"
        ),
        api.get<{ tasks: ApiTask[] }>("/api/tasks"),
        api.get<{ team: ApiTeamMember[] }>("/api/team"),
        api.get<{ risks: ApiRisk[] }>("/api/risks"),
      ]);

      const nextState = buildDashboardStateFromApi({
        projects: projectsRes.projects ?? [],
        tasks: tasksRes.tasks ?? [],
        team: teamRes.team ?? [],
        risks: risksRes.risks ?? [],
      });

      setState(nextState);
      writeCachedState(nextState);
      return nextState;
    } catch (loadError) {
      if (!isExpectedDashboardLoadError(loadError)) {
        console.error("Failed to load dashboard data", loadError);
      }
      setError(loadError instanceof Error ? loadError.message : t("error.loadDescription"));

      setIsDegradedMode(true);

      if (!IS_PRODUCTION) {
        const cachedState = readCachedState();
        if (cachedState && cachedState.projects.length > 0) {
          setState(cachedState);
          return cachedState;
        }
      }

      setState(emptyDashboardState);
      return emptyDashboardState;
    } finally {
      setIsLoading(false);
    }
  }, [isDemoWorkspace, t]);

  useEffect(() => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    if (isPublicPage) {
      setState(emptyDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    void loadDashboardData();
  }, [isDemoWorkspace, isPublicPage, loadDashboardData]);

  useEffect(() => {
    if (isPublicPage || isDemoWorkspace || isLoading) return;
    // P3-2: Use debounced write to avoid excessive localStorage writes
    writeCachedStateDebounced(state);
  }, [isDemoWorkspace, isPublicPage, isLoading, state]);

  const notifications = useMemo(() => buildNotifications(state, t), [state, t]);

  const retry = () => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    setIsDegradedMode(false);
    void loadDashboardData();
  };

  const refreshMutations = async (reload = true) => {
    if (reload) {
      await loadDashboardData({ silent: true });
    }
    revalidateAll();
  };

  const notifyDemoReadonly = () => {
    toast.info("Публичное demo работает в режиме read-only", {
      description: "Сначала смотрим сценарии и метрики, а боевые изменения остаются за логином.",
    });
  };

  const addProject = async (values: ProjectFormValues) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const tempId = `temp-project-${Date.now()}`;
    const optimisticProject = createOptimisticProject(values, tempId);
    const previousState = state;

    setState((current) => ({
      ...current,
      projects: [optimisticProject, ...current.projects],
    }));

    try {
      await api.post<ApiProject>("/api/projects", {
        name: values.name,
        description: values.description,
        direction: values.direction,
        status: denormalizeProjectStatus(values.status),
        priority: values.priority,
        start: values.start,
        end: values.end,
        budgetPlan: values.plannedBudget,
        budgetFact: values.actualBudget,
        progress: values.progress,
        location: values.location,
        teamIds: state.team
          .filter((member) => values.team.includes(member.name))
          .map((member) => member.id),
      });

      await refreshMutations();

      toast.success(t("toast.projectCreated"), {
        description: t("toast.projectCreatedDesc", { name: values.name }),
      });
    } catch (mutationError) {
      console.error("Add project failed", mutationError);
      setState(previousState);
      toast.error(t("toast.projectCreateFailed"));
    }
  };

  const updateProject = async (projectId: string, values: ProjectFormValues) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const previousState = state;

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              name: values.name,
              description: values.description,
              direction: values.direction,
              budget: {
                planned: values.plannedBudget,
                actual: values.actualBudget,
                currency: values.currency || "RUB",
              },
              dates: { start: values.start, end: values.end },
              team: values.team,
              location: values.location,
              priority: values.priority,
              status: values.status,
              progress: values.progress,
              history: project.history.length
                ? project.history.map((point, index) =>
                    index === project.history.length - 1
                      ? {
                          ...point,
                          progress: values.progress,
                          budgetActual: values.actualBudget,
                        }
                      : point
                  )
                : project.history,
            }
          : project
      ),
    }));

    try {
      await api.put<ApiProject>(`/api/projects/${projectId}`, {
        name: values.name,
        description: values.description,
        direction: values.direction,
        budgetPlan: values.plannedBudget,
        budgetFact: values.actualBudget,
        start: values.start,
        end: values.end,
        location: values.location,
        priority: values.priority,
        status: denormalizeProjectStatus(values.status),
        progress: values.progress,
        teamIds: state.team
          .filter((member) => values.team.includes(member.name))
          .map((member) => member.id),
      });

      await refreshMutations();

      toast.success(t("toast.projectUpdated"), {
        description: t("toast.projectUpdatedDesc", { name: values.name }),
      });
    } catch (mutationError) {
      console.error("Update project failed", mutationError);
      setState(previousState);
      toast.error(t("toast.projectUpdateFailed"));
    }
  };

  const deleteProject = async (projectId: string) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const previousState = state;
    const project = state.projects.find((item) => item.id === projectId);

    setState((current) => ({
      projects: current.projects.filter((item) => item.id !== projectId),
      tasks: current.tasks.filter((item) => item.projectId !== projectId),
      team: current.team,
      risks: current.risks.filter((item) => item.projectId !== projectId),
      documents: current.documents.filter((item) => item.projectId !== projectId),
      milestones: current.milestones.filter((item) => item.projectId !== projectId),
      currentUser: current.currentUser,
      auditLogEntries: current.auditLogEntries,
    }));

    try {
      await api.delete<{ deleted: true }>(`/api/projects/${projectId}`);
      revalidateAll();
      toast.success(t("toast.projectDeleted"), {
        description: t("toast.projectDeletedDesc", {
          name: project?.name ?? t("page.project.title"),
        }),
      });
    } catch (mutationError) {
      console.error("Delete project failed", mutationError);
      setState(previousState);
      toast.error(t("toast.projectDeleteFailed"));
    }
  };

  const addTasksBatch = async (payloads: AddTaskPayload[]) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    if (!payloads.length) return;

    const tempTasks = payloads.map((payload, index) =>
      createOptimisticTask(
        {
          ...payload,
          tags: payload.tags?.length ? payload.tags : ["ai-generated"],
        },
        `temp-task-${Date.now()}-${index}`,
        payload.order ?? index
      )
    );
    const previousState = state;

    setState((current) => ({
      ...current,
      tasks: [...tempTasks, ...current.tasks],
    }));

    try {
      await Promise.all(
        payloads.map((payload) => {
          const assigneeId =
            state.team.find((member) => member.name === payload.assignee)?.id ?? null;
          return api.post<ApiTask>("/api/tasks", {
            title: payload.title,
            description: payload.description,
            projectId: payload.projectId,
            assigneeId,
            dueDate: payload.dueDate,
            status: denormalizeTaskStatus(payload.status ?? "todo"),
            priority: payload.priority ?? "medium",
            order: payload.order,
          });
        })
      );

      await refreshMutations();

      toast.success(t("toast.tasksCreated"), {
        description: t("toast.tasksCreatedDesc", {
          count: payloads.length,
        }),
      });
    } catch (mutationError) {
      console.error("Add tasks batch failed", mutationError);
      setState(previousState);
      toast.error(t("toast.taskCreateFailed"));
    }
  };

  const duplicateProject = async (projectId: string) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const source = state.projects.find((project) => project.id === projectId);
    if (!source) return;

    try {
      const original = await api.get<
        ApiProject & {
          milestones?: ApiMilestone[];
          documents?: ApiDocument[];
        }
      >(`/api/projects/${projectId}`);

      const teamIds = (original.team ?? [])
        .map((member) => (typeof member === "string" ? null : member.id))
        .filter((memberId): memberId is string => typeof memberId === "string");

      const clonedProject = await api.post<ApiProject>("/api/projects", {
        name: `${original.name ?? source.name} (копия)`,
        description: original.description,
        direction: original.direction,
        status: "planning",
        priority: original.priority,
        start: original.start ?? original.dates?.start ?? source.dates.start,
        end: original.end ?? original.dates?.end ?? source.dates.end,
        budgetPlan: original.budgetPlan ?? original.budget?.planned ?? source.budget.planned,
        budgetFact: 0,
        progress: 0,
        location: original.location,
        teamIds,
      });

      const sourceTasks = original.tasks ?? [];
      const sourceRisks = Array.isArray(original.risks) ? original.risks : [];
      const sourceMilestones = original.milestones ?? [];
      const sourceDocuments = original.documents ?? [];

      await Promise.all([
        ...sourceTasks.map((task) =>
          api.post<ApiTask>("/api/tasks", {
            title: task.title,
            description: task.description,
            projectId: clonedProject.id,
            assigneeId: task.assigneeId ?? null,
            dueDate: task.dueDate,
            status: "todo",
            priority: task.priority,
          })
        ),
        ...sourceRisks.map((risk) =>
          api.post<ApiRisk>("/api/risks", {
            title: risk.title,
            description: risk.description,
            projectId: clonedProject.id,
            ownerId: risk.ownerId ?? null,
            probability: risk.probability,
            impact: risk.impact,
            status: risk.status,
          })
        ),
        ...sourceMilestones.map((milestone) =>
          api.post<ApiMilestone>("/api/milestones", {
            title: milestone.title,
            description: milestone.description,
            projectId: clonedProject.id,
            date: milestone.date,
            status: "upcoming",
          })
        ),
        ...sourceDocuments.map((document) =>
          api.post<ApiDocument>("/api/documents", {
            title: document.title,
            description: document.description,
            projectId: clonedProject.id,
            filename: document.filename,
            url: document.url,
            type: document.type,
            size: document.size,
            ownerId: document.ownerId ?? null,
          })
        ),
      ]);

      await refreshMutations();

      toast.success(t("toast.projectDuplicated"), {
        description: t("toast.projectDuplicatedDesc", {
          name: `${source.name} (копия)`,
        }),
      });
    } catch (mutationError) {
      console.error("Duplicate project failed", mutationError);
      toast.error(t("toast.projectDuplicateFailed"));
    }
  };

  const addTask = async (payload: AddTaskPayload) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const project = state.projects.find((item) => item.id === payload.projectId);
    const nextOrder =
      state.tasks
        .filter(
          (task) =>
            task.projectId === payload.projectId &&
            task.status === (payload.status ?? "todo")
        )
        .reduce((max, task) => Math.max(max, task.order), -1) + 1;

    const tempId = `temp-task-${Date.now()}`;
    const optimisticTask = createOptimisticTask(payload, tempId, nextOrder);

    setState((current) => ({
      ...current,
      tasks: [optimisticTask, ...current.tasks],
    }));

    try {
      const assigneeId =
        state.team.find((member) => member.name === payload.assignee)?.id ?? null;

      await api.post<ApiTask>("/api/tasks", {
        title: payload.title,
        description: payload.description,
        projectId: payload.projectId,
        assigneeId,
        dueDate: payload.dueDate,
        status: denormalizeTaskStatus(payload.status ?? "todo"),
        priority: payload.priority ?? "medium",
        order: payload.order ?? nextOrder,
      });

      await refreshMutations();

      toast.success(t("toast.taskCreated"), {
        description: t("toast.taskCreatedDesc", {
          name: project ? `${project.name}: ${payload.title}` : payload.title,
        }),
      });
    } catch (mutationError) {
      console.error("Add task failed", mutationError);
      setState((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== tempId),
      }));
      toast.error(t("toast.taskCreateFailed"));
    }
  };

  const updateTaskStatus = async (taskIds: string[], status: TaskStatus) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const previousState = state;

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (!taskIds.includes(task.id)) {
          return task;
        }

        const nextOrder =
          current.tasks
            .filter(
              (candidate) =>
                candidate.projectId === task.projectId &&
                candidate.status === status &&
                !taskIds.includes(candidate.id)
            )
            .reduce((max, candidate) => Math.max(max, candidate.order), -1) + 1;

        return {
          ...task,
          status,
          order: nextOrder,
        };
      }),
    }));

    try {
      await Promise.all(
        taskIds.map((id) =>
          api.put<ApiTask>(`/api/tasks/${id}`, {
            status: denormalizeTaskStatus(status),
          })
        )
      );

      await refreshMutations();

      toast.success(t("toast.tasksUpdated"), {
        description: t("toast.tasksUpdatedDesc", {
          count: taskIds.length,
        }),
      });
    } catch (mutationError) {
      console.error("Update task status failed", mutationError);
      setState(previousState);
      toast.error(t("toast.updateFailed"));
    }
  };

  const reorderKanbanTasks = async (
    projectId: string,
    nextColumns: Partial<Record<TaskStatus, string[]>>
  ) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const previousState = state;
    const nextTaskMeta = new Map<string, { status: TaskStatus; order: number }>();

    (Object.entries(nextColumns) as Array<[TaskStatus, string[] | undefined]>).forEach(
      ([status, ids]) => {
        ids?.forEach((taskId, index) => {
          nextTaskMeta.set(taskId, { status, order: index });
        });
      }
    );

    if (!nextTaskMeta.size) return;

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.projectId !== projectId) {
          return task;
        }

        const nextMeta = nextTaskMeta.get(task.id);
        if (!nextMeta) {
          return task;
        }

        return {
          ...task,
          status: nextMeta.status,
          order: nextMeta.order,
        };
      }),
    }));

    try {
      const dbColumns = Object.fromEntries(
        Object.entries(nextColumns).map(([status, ids]) => [
          denormalizeTaskStatus(status as TaskStatus),
          ids ?? [],
        ])
      );

      await api.post<{ reordered: true; count: number }>("/api/tasks/reorder", {
        projectId,
        columns: dbColumns,
      });

      revalidateAll();
      toast.success(t("toast.tasksReordered"));
    } catch (mutationError) {
      console.error("Reorder kanban tasks failed", mutationError);
      setState(previousState);
      toast.error(t("toast.reorderFailed"));
    }
  };

  const setProjectStatus = async (projectId: string, status: ProjectStatus) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const previousState = state;

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? { ...project, status } : project
      ),
    }));

    try {
      await api.put<ApiProject>(`/api/projects/${projectId}`, {
        status: denormalizeProjectStatus(status),
      });

      revalidateAll();
      toast.success(t("toast.projectStatus"), {
        description: t("toast.projectStatusDesc", {
          status: enumLabel("projectStatus", status),
        }),
      });
    } catch (mutationError) {
      console.error("Set project status failed", mutationError);
      setState(previousState);
      toast.error(t("toast.projectUpdateFailed"));
    }
  };

  return (
    <DashboardContext.Provider
      value={{
        ...state,
        isHydrating: isLoading,
        isLoading,
        error,
        isDegradedMode,
        notifications,
        retry,
        addProject,
        updateProject,
        deleteProject,
        duplicateProject,
        addTask,
        addTasksBatch,
        updateTaskStatus,
        reorderKanbanTasks,
        setProjectStatus,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }

  return context;
}
