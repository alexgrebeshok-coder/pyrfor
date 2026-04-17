import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import {
  denormalizeProjectStatus,
  denormalizeTaskStatus,
  type ApiDocument,
  type ApiMilestone,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
} from "@/lib/client/normalizers";
import { api } from "@/lib/client/api-error";
import { revalidateAll } from "@/lib/hooks/use-api";
import type {
  DashboardState,
  TaskStatus,
} from "@/lib/types";
import type { MessageKey } from "@/lib/translations";

import {
  createOptimisticProject,
  createOptimisticTask,
} from "@/components/dashboard-provider-helpers";
import type {
  DashboardContextValue,
} from "@/components/dashboard-provider.types";

type DashboardMutations = Pick<
  DashboardContextValue,
  | "addProject"
  | "updateProject"
  | "deleteProject"
  | "duplicateProject"
  | "addTask"
  | "addTasksBatch"
  | "updateTaskStatus"
  | "reorderKanbanTasks"
  | "setProjectStatus"
>;

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>
) => string;

type EnumLabel = (
  category:
    | "severity"
    | "projectStatus"
    | "taskStatus"
    | "priority"
    | "direction"
    | "riskStatus",
  value: string
) => string;

interface CreateDashboardActionsArgs {
  enumLabel: EnumLabel;
  isDemoWorkspace: boolean;
  loadDashboardData: (options?: { silent?: boolean }) => Promise<DashboardState>;
  notifyDemoReadonly: () => void;
  setState: Dispatch<SetStateAction<DashboardState>>;
  state: DashboardState;
  t: Translate;
}

export function createDashboardActions({
  enumLabel,
  isDemoWorkspace,
  loadDashboardData,
  notifyDemoReadonly,
  setState,
  state,
  t,
}: CreateDashboardActionsArgs): DashboardMutations {
  const refreshMutations = async (reload = true) => {
    if (reload) {
      await loadDashboardData({ silent: true });
    }
    revalidateAll();
  };

  const addProject: DashboardMutations["addProject"] = async (values) => {
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

  const updateProject: DashboardMutations["updateProject"] = async (
    projectId,
    values
  ) => {
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

  const deleteProject: DashboardMutations["deleteProject"] = async (projectId) => {
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

  const addTasksBatch: DashboardMutations["addTasksBatch"] = async (payloads) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    if (!payloads.length) {
      return;
    }

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

  const duplicateProject: DashboardMutations["duplicateProject"] = async (
    projectId
  ) => {
    if (isDemoWorkspace) {
      notifyDemoReadonly();
      return;
    }

    const source = state.projects.find((project) => project.id === projectId);
    if (!source) {
      return;
    }

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
        budgetPlan:
          original.budgetPlan ?? original.budget?.planned ?? source.budget.planned,
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

  const addTask: DashboardMutations["addTask"] = async (payload) => {
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

  const updateTaskStatus: DashboardMutations["updateTaskStatus"] = async (
    taskIds,
    status
  ) => {
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

  const reorderKanbanTasks: DashboardMutations["reorderKanbanTasks"] = async (
    projectId,
    nextColumns
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

    if (!nextTaskMeta.size) {
      return;
    }

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

  const setProjectStatus: DashboardMutations["setProjectStatus"] = async (
    projectId,
    status
  ) => {
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

  return {
    addProject,
    updateProject,
    deleteProject,
    duplicateProject,
    addTask,
    addTasksBatch,
    updateTaskStatus,
    reorderKanbanTasks,
    setProjectStatus,
  };
}
