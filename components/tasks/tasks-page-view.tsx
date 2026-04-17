"use client";

import type { Dispatch, SetStateAction } from "react";
import { CheckSquare2, Download, Filter, Plus } from "lucide-react";

import { AIContextActions } from "@/components/ai/ai-context-actions";
import { TasksPageResults } from "@/components/tasks/tasks-page-results";
import { TaskDependencyWorkspace } from "@/components/tasks/task-dependency-workspace";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { fieldStyles } from "@/components/ui/field";
import {
  AIContextActionsSkeleton,
  KpiCardSkeleton,
  TaskTableSkeleton,
} from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { downloadTasksCsv } from "@/lib/export";
import type { Priority, Project, Task, TaskStatus } from "@/lib/types";

interface TasksPageViewProps {
  canManageTasks: boolean;
  dependencyTaskId: string | null;
  error: unknown;
  filteredTasks: Task[];
  isLoading: boolean;
  mergedTasks: Task[];
  mutateTasks: () => Promise<unknown>;
  onRetry: () => void;
  priority: "all" | Priority;
  projectFilter: "all" | string;
  projects: Project[];
  projectsError: unknown;
  projectsLoading: boolean;
  searchQuery: string;
  selectedIds: string[];
  setDependencyTaskId: Dispatch<SetStateAction<string | null>>;
  setPriority: Dispatch<SetStateAction<"all" | Priority>>;
  setProjectFilter: Dispatch<SetStateAction<"all" | string>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<"all" | TaskStatus>>;
  setTaskModalOpen: Dispatch<SetStateAction<boolean>>;
  status: "all" | TaskStatus;
  taskModalOpen: boolean;
  toggleTask: (taskId: string) => void;
  updateTaskStatus: (taskIds: string[], status: TaskStatus) => void;
}

export function TasksPageView({
  canManageTasks,
  dependencyTaskId,
  error,
  filteredTasks,
  isLoading,
  mergedTasks,
  mutateTasks,
  onRetry,
  priority,
  projectFilter,
  projects,
  projectsError,
  projectsLoading,
  searchQuery,
  selectedIds,
  setDependencyTaskId,
  setPriority,
  setProjectFilter,
  setSearchQuery,
  setStatus,
  setTaskModalOpen,
  status,
  taskModalOpen,
  toggleTask,
  updateTaskStatus,
}: TasksPageViewProps) {
  const { enumLabel, locale, t } = useLocale();

  const projectNameById = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const dependencyTask = dependencyTaskId
    ? mergedTasks.find((task) => task.id === dependencyTaskId) ?? null
    : null;
  const hasTaskFilters =
    status !== "all" || priority !== "all" || projectFilter !== "all" || searchQuery.trim().length > 0;
  const dependencyFocusNote =
    locale === "ru"
      ? "Выбранная задача скрыта текущими фильтрами, но dependency workspace остаётся доступным."
      : locale === "zh"
        ? "当前筛选条件隐藏了这条任务，但 dependency workspace 仍然保持打开。"
        : "The selected task is hidden by current filters, but the dependency workspace stays open.";
  const showHydrationSkeleton =
    isLoading && projectsLoading && projects.length === 0 && mergedTasks.length === 0;
  const totalTasks = mergedTasks.length;
  const inProgressTasks = mergedTasks.filter((task) => task.status === "in-progress").length;
  const blockedTasks = mergedTasks.filter((task) => task.status === "blocked").length;

  if (showHydrationSkeleton) {
    return (
      <div className="grid min-w-0 gap-3">
        <AIContextActionsSkeleton />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <KpiCardSkeleton key={index} />
          ))}
        </div>

        <TaskTableSkeleton />
      </div>
    );
  }

  if ((error || projectsError) && projects.length === 0 && mergedTasks.length === 0) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={
          error instanceof Error
            ? error.message
            : projectsError instanceof Error
              ? projectsError.message
              : t("error.loadDescription")
        }
        onRetry={onRetry}
        title={t("error.loadTitle")}
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-3" data-testid="tasks-page">
      <AIContextActions />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="tasks-summary">
        <Card className="p-2">
          <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.total")}</p>
          <p className="text-lg font-bold">{totalTasks}</p>
        </Card>
        <Card className="p-2">
          <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.inProgress")}</p>
          <p className="text-lg font-bold text-blue-600">{inProgressTasks}</p>
        </Card>
        <Card className="p-2">
          <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.blocked")}</p>
          <p className="text-lg font-bold text-red-600">{blockedTasks}</p>
        </Card>
        <Card className="p-2">
          <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.selected")}</p>
          <p className="text-lg font-bold">{selectedIds.length}</p>
        </Card>
      </div>

      <Card className="app-page-intro-card p-3">
        <div className="mb-4 grid gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Исполнительный ритм
              </p>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-[-0.04em] text-[var(--ink)]">{t("tasks.title")}</h2>
                  <span className="rounded-full border border-[var(--line)] bg-[var(--panel-soft)]/70 px-2.5 py-1 text-xs text-[var(--ink-muted)]">
                    {filteredTasks.length} задач в текущем срезе
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                  Здесь должно быть сразу понятно, где блокировки, кто держит следующий шаг и какие задачи уже
                  выпали из рабочего темпа.
                </p>
              </div>
            </div>

            <Button
              className="h-10 w-full px-4 sm:w-auto"
              data-testid="create-task-button"
              disabled={!canManageTasks}
              onClick={() => setTaskModalOpen(true)}
              size="sm"
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("action.addTask")}
            </Button>
          </div>

          <div className="grid gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <select
              className={fieldStyles + " !py-1 h-10 text-sm"}
              data-testid="tasks-status-filter"
              onChange={(event) => setStatus(event.target.value as "all" | TaskStatus)}
              value={status}
            >
              <option value="all">{t("filters.allStatuses")}</option>
              <option value="todo">{enumLabel("taskStatus", "todo")}</option>
              <option value="in-progress">{enumLabel("taskStatus", "in-progress")}</option>
              <option value="done">{enumLabel("taskStatus", "done")}</option>
              <option value="blocked">{enumLabel("taskStatus", "blocked")}</option>
            </select>
            <select
              className={fieldStyles + " !py-1 h-10 text-sm"}
              data-testid="tasks-priority-filter"
              onChange={(event) => setPriority(event.target.value as "all" | Priority)}
              value={priority}
            >
              <option value="all">{t("filters.allPriorities")}</option>
              <option value="low">{enumLabel("priority", "low")}</option>
              <option value="medium">{enumLabel("priority", "medium")}</option>
              <option value="high">{enumLabel("priority", "high")}</option>
              <option value="critical">{enumLabel("priority", "critical")}</option>
            </select>
            <select
              className={fieldStyles + " !py-1 h-10 text-sm"}
              data-testid="tasks-project-filter"
              onChange={(event) => setProjectFilter(event.target.value)}
              value={projectFilter}
            >
              <option value="all">{t("filters.allProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <input
              className={fieldStyles + " !py-1 h-10 text-sm"}
              data-testid="tasks-search-input"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("filters.search") || "Search..."}
              type="text"
              value={searchQuery}
            />
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/38 p-2 sm:flex-row">
          <Button
            className="h-9 px-3 text-xs"
            disabled={!selectedIds.length || !canManageTasks}
            onClick={() => updateTaskStatus(selectedIds, "in-progress")}
            size="sm"
            variant="secondary"
          >
            <Filter className="mr-1 h-3 w-3" />
            {t("tasks.bulkMove")}
          </Button>
          <Button
            className="h-9 px-3 text-xs"
            disabled={!selectedIds.length || !canManageTasks}
            onClick={() => updateTaskStatus(selectedIds, "done")}
            size="sm"
            variant="secondary"
          >
            <CheckSquare2 className="mr-1 h-3 w-3" />
            {t("tasks.bulkDone")}
          </Button>
          <Button
            className="h-9 px-3 text-xs"
            onClick={() => downloadTasksCsv(filteredTasks)}
            size="sm"
            variant="outline"
          >
            <Download className="mr-1 h-3 w-3" />
            {t("action.exportExcel")}
          </Button>
        </div>

        {dependencyTask ? (
          <div className="mb-3 grid gap-2">
            {filteredTasks.some((task) => task.id === dependencyTask.id) ? null : (
              <p className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-[var(--ink-soft)]">
                {dependencyFocusNote}
              </p>
            )}
            <TaskDependencyWorkspace
              onClose={() => setDependencyTaskId(null)}
              onDependenciesUpdated={async () => {
                await mutateTasks();
              }}
              projectName={projectNameById[dependencyTask.projectId]}
              readOnly={!canManageTasks}
              task={dependencyTask}
            />
          </div>
        ) : null}

        <TasksPageResults
          canManageTasks={canManageTasks}
          dependencyTaskId={dependencyTaskId}
          filteredTasks={filteredTasks}
          hasTaskFilters={hasTaskFilters}
          onAddTask={() => setTaskModalOpen(true)}
          onClearFilters={() => {
            setStatus("all");
            setPriority("all");
            setProjectFilter("all");
            setSearchQuery("");
          }}
          projectNameById={projectNameById}
          selectedIds={selectedIds}
          setDependencyTaskId={setDependencyTaskId}
          toggleTask={toggleTask}
        />
      </Card>

      <TaskFormModal onOpenChange={setTaskModalOpen} open={canManageTasks && taskModalOpen} />
    </div>
  );
}
