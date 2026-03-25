"use client";

import { useMemo, useState } from "react";
import { CheckSquare2, Download, Filter, Link2, Plus } from "lucide-react";

import { AIContextActions } from "@/components/ai/ai-context-actions";
import { useDashboard } from "@/components/dashboard-provider";
import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { TaskDependencyWorkspace } from "@/components/tasks/task-dependency-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { fieldStyles } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AIContextActionsSkeleton,
  KpiCardSkeleton,
  TaskTableSkeleton,
} from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/contexts/locale-context";
import { downloadTasksCsv } from "@/lib/export";
import { useProjects, useTasks } from "@/lib/hooks/use-api";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import { Priority, TaskStatus } from "@/lib/types";
import { priorityMeta, taskStatusMeta } from "@/lib/utils";

export function TasksPage({
  initialQuery = "",
  initialProjectId = "",
  initialTasks = [],
}: {
  initialQuery?: string;
  initialProjectId?: string;
  initialTasks?: ReturnType<typeof useTasks>["tasks"];
}) {
  const { enumLabel, locale, formatDateLocalized, t } = useLocale();
  const { allowed: canManageTasks } = usePlatformPermission("MANAGE_TASKS");
  const { tasks: dashboardTasks, updateTaskStatus } = useDashboard();
  const { error, isLoading, mutate: mutateTasks, tasks: apiTasks } = useTasks();
  const {
    error: projectsError,
    isLoading: projectsLoading,
    mutate: mutateProjects,
    projects,
  } = useProjects();
  const [status, setStatus] = useState<"all" | TaskStatus>("all");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [projectFilter, setProjectFilter] = useState<"all" | string>(initialProjectId || "all");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [dependencyTaskId, setDependencyTaskId] = useState<string | null>(null);

  const mergedTasks = useMemo(() => {
    const taskMap = new Map<string, (typeof dashboardTasks)[number]>();

    for (const task of initialTasks) {
      taskMap.set(task.id, task);
    }

    for (const task of dashboardTasks) {
      taskMap.set(task.id, task);
    }

    for (const task of apiTasks) {
      taskMap.set(task.id, task);
    }

    return Array.from(taskMap.values());
  }, [apiTasks, dashboardTasks, initialTasks]);

  const filteredTasks = useMemo(
    () =>
      mergedTasks.filter((task) => {
        const statusMatch = status === "all" ? true : task.status === status;
        const priorityMatch = priority === "all" ? true : task.priority === priority;
        const projectMatch = projectFilter === "all" ? true : task.projectId === projectFilter;
        const searchMatch = searchQuery === "" ? true : 
          task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
        return statusMatch && priorityMatch && projectMatch && searchMatch;
      }),
    [mergedTasks, priority, status, projectFilter, searchQuery]
  );

  const projectNameById = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const dependencyTask = dependencyTaskId
    ? mergedTasks.find((task) => task.id === dependencyTaskId) ?? null
    : null;
  const hasTaskFilters =
    status !== "all" || priority !== "all" || projectFilter !== "all" || searchQuery.trim().length > 0;
  const clearFiltersLabel =
    locale === "ru" ? "Очистить фильтры" : locale === "zh" ? "清除筛选" : "Clear filters";
  const dependencyToggleLabel =
    locale === "ru" ? "Зависимости" : locale === "zh" ? "依赖关系" : "Dependencies";
  const dependencyFocusNote =
    locale === "ru"
      ? "Выбранная задача скрыта текущими фильтрами, но dependency workspace остаётся доступным."
      : locale === "zh"
        ? "当前筛选条件隐藏了这条任务，但 dependency workspace 仍然保持打开。"
        : "The selected task is hidden by current filters, but the dependency workspace stays open.";

  const toggleTask = (taskId: string) => {
    setSelectedIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId]
    );
  };
  const showHydrationSkeleton =
    isLoading && projectsLoading && projects.length === 0 && mergedTasks.length === 0;

  const handleRetry = () => {
    void Promise.all([mutateProjects(), mutateTasks()]);
  };

  // Stats
  const totalTasks = mergedTasks.length;
  const inProgressTasks = mergedTasks.filter((task) => task.status === "in-progress").length;
  const blockedTasks = mergedTasks.filter((task) => task.status === "blocked").length;

  if (showHydrationSkeleton) {
    return (
      <div className="grid min-w-0 gap-3">
        <AIContextActionsSkeleton />

        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
        onRetry={handleRetry}
        title={t("error.loadTitle")}
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-3" data-testid="tasks-page">
      <AIContextActions />

      {/* Compact KPI Row */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4" data-testid="tasks-summary">
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

      {/* Main Card */}
      <Card className="p-3">
        {/* Header + Filters in one row */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">{t("tasks.title")}</h2>
            <span className="text-xs text-muted-foreground">({filteredTasks.length})</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:flex sm:gap-2">
              <select
                className={`${fieldStyles} !py-1 h-9 text-xs`}
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
                className={`${fieldStyles} !py-1 h-9 text-xs`}
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
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:flex sm:gap-2">
              <select
                className={`${fieldStyles} !py-1 h-9 text-xs`}
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
                className={`${fieldStyles} !py-1 h-9 text-xs flex-1 sm:w-32`}
                data-testid="tasks-search-input"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("filters.search") || "Search..."}
                type="text"
                value={searchQuery}
              />
            </div>
            <Button
              size="sm"
              onClick={() => setTaskModalOpen(true)}
              disabled={!canManageTasks}
              className="h-9 px-3 w-full sm:w-auto"
              data-testid="create-task-button"
            >
              <Plus className="h-3 w-3 mr-1" />
              {t("action.addTask")}
            </Button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            disabled={!selectedIds.length || !canManageTasks}
            onClick={() => updateTaskStatus(selectedIds, "in-progress")}
            variant="secondary"
            className="h-9 px-3 text-xs"
          >
            <Filter className="h-3 w-3 mr-1" />
            {t("tasks.bulkMove")}
          </Button>
          <Button
            size="sm"
            disabled={!selectedIds.length || !canManageTasks}
            onClick={() => updateTaskStatus(selectedIds, "done")}
            variant="secondary"
            className="h-9 px-3 text-xs"
          >
            <CheckSquare2 className="h-3 w-3 mr-1" />
            {t("tasks.bulkDone")}
          </Button>
          <Button size="sm" onClick={() => downloadTasksCsv(filteredTasks)} variant="outline" className="h-9 px-3 text-xs">
            <Download className="h-3 w-3 mr-1" />
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

        {filteredTasks.length === 0 ? (
          <EmptyState
            className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60"
            data-testid="tasks-empty-state"
            description={
              hasTaskFilters
                ? locale === "ru"
                  ? "Попробуйте убрать часть фильтров или создать новую задачу."
                  : locale === "zh"
                    ? "尝试清除部分筛选条件，或创建一个新任务。"
                    : "Try clearing some filters or create a new task."
                : locale === "ru"
                  ? "Создайте первую задачу, чтобы она появилась здесь и в других пространствах."
                  : locale === "zh"
                    ? "创建第一条任务记录，让它在这里和其他视图中出现。"
                    : "Create your first task to populate this view and the other surfaces."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {hasTaskFilters ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setStatus("all");
                      setPriority("all");
                      setProjectFilter("all");
                      setSearchQuery("");
                    }}
                  >
                    {clearFiltersLabel}
                  </Button>
                ) : null}
                <Button disabled={!canManageTasks} onClick={() => setTaskModalOpen(true)}>
                  {t("action.addTask")}
                </Button>
              </div>
            }
            title={
              hasTaskFilters
                ? locale === "ru"
                  ? "Ничего не найдено"
                  : locale === "zh"
                    ? "没有找到任务"
                    : "No tasks found"
                : locale === "ru"
                  ? "Пока нет задач"
                  : locale === "zh"
                    ? "暂无任务"
                    : "No tasks yet"
            }
            type="tasks"
          />
        ) : (
          <>
            <div className="grid gap-2 md:hidden" data-testid="task-mobile-list">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/45 p-3"
                  data-testid="task-card"
                  data-task-id={task.id}
                >
                  <div className="flex items-start gap-3">
                    <input
                      checked={selectedIds.includes(task.id)}
                      onChange={() => toggleTask(task.id)}
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-5 text-[var(--ink)]">{task.title}</p>
                        <Badge className={`${taskStatusMeta[task.status].className} shrink-0 px-1.5 py-0.5 text-[10px]`}>
                          {enumLabel("taskStatus", task.status)}
                        </Badge>
                      </div>
                      <div className="grid gap-1 text-xs text-muted-foreground">
                        <p className="truncate">{projectNameById[task.projectId]}</p>
                        <p>{task.assignee?.name || "-"}</p>
                        <div className="flex items-center justify-between gap-2">
                          <span>{formatDateLocalized(task.dueDate, "d MMM")}</span>
                          <Badge className={`${priorityMeta[task.priority].className} px-1.5 py-0.5 text-[10px]`}>
                            {enumLabel("priority", task.priority)}
                          </Badge>
                        </div>
                        <TaskDependencyBadges compact task={task} />
                        <Button
                          className="h-7 w-full px-2 text-[11px]"
                          onClick={() =>
                            setDependencyTaskId((current) => (current === task.id ? null : task.id))
                          }
                          size="sm"
                          variant={dependencyTaskId === task.id ? "secondary" : "outline"}
                        >
                          <Link2 className="h-3 w-3" />
                          {dependencyToggleLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Compact Table */}
            <div className="hidden overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 md:block" data-testid="task-table">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8 py-1.5"></TableHead>
                    <TableHead className="py-1.5 text-xs">{t("project.tasks")}</TableHead>
                    <TableHead className="py-1.5 text-xs">{t("tasks.project")}</TableHead>
                    <TableHead className="py-1.5 text-xs">{t("field.status")}</TableHead>
                    <TableHead className="py-1.5 text-xs">{t("tasks.assignee")}</TableHead>
                    <TableHead className="py-1.5 text-xs">{t("tasks.dueDate")}</TableHead>
                    <TableHead className="py-1.5 text-xs">{t("tasks.priority")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.map((task) => (
                    <TableRow key={task.id} className="group" data-testid="task-row" data-task-id={task.id}>
                      <TableCell className="py-1.5">
                        <input
                          checked={selectedIds.includes(task.id)}
                          onChange={() => toggleTask(task.id)}
                          type="checkbox"
                          className="h-5 w-5"
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="max-w-[240px]">
                          <p className="truncate text-xs font-medium">{task.title}</p>
                          <TaskDependencyBadges compact task={task} />
                          <Button
                            className="mt-2 h-7 px-2 text-[11px]"
                            onClick={() =>
                              setDependencyTaskId((current) => (current === task.id ? null : task.id))
                            }
                            size="sm"
                            variant={dependencyTaskId === task.id ? "secondary" : "outline"}
                          >
                            <Link2 className="h-3 w-3" />
                            {dependencyToggleLabel}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate py-1.5 text-xs text-muted-foreground">
                        {projectNameById[task.projectId]}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge className={`${taskStatusMeta[task.status].className} px-1.5 py-0.5 text-[10px]`}>
                          {enumLabel("taskStatus", task.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">
                        {task.assignee?.name || "-"}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">
                        {formatDateLocalized(task.dueDate, "d MMM")}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge className={`${priorityMeta[task.priority].className} px-1.5 py-0.5 text-[10px]`}>
                          {enumLabel("priority", task.priority)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <TaskFormModal
        open={canManageTasks && taskModalOpen}
        onOpenChange={setTaskModalOpen}
      />
    </div>
  );
}
