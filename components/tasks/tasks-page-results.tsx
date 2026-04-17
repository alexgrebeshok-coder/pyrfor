"use client";

import type { Dispatch, SetStateAction } from "react";
import { Link2 } from "lucide-react";

import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/contexts/locale-context";
import type { Task } from "@/lib/types";
import { priorityMeta, taskStatusMeta } from "@/lib/utils";

interface TasksPageResultsProps {
  canManageTasks: boolean;
  dependencyTaskId: string | null;
  filteredTasks: Task[];
  hasTaskFilters: boolean;
  onAddTask: () => void;
  onClearFilters: () => void;
  projectNameById: Record<string, string>;
  selectedIds: string[];
  setDependencyTaskId: Dispatch<SetStateAction<string | null>>;
  toggleTask: (taskId: string) => void;
}

export function TasksPageResults({
  canManageTasks,
  dependencyTaskId,
  filteredTasks,
  hasTaskFilters,
  onAddTask,
  onClearFilters,
  projectNameById,
  selectedIds,
  setDependencyTaskId,
  toggleTask,
}: TasksPageResultsProps) {
  const { enumLabel, formatDateLocalized, locale, t } = useLocale();
  const clearFiltersLabel =
    locale === "ru" ? "Очистить фильтры" : locale === "zh" ? "清除筛选" : "Clear filters";
  const dependencyToggleLabel =
    locale === "ru" ? "Зависимости" : locale === "zh" ? "依赖关系" : "Dependencies";

  if (filteredTasks.length === 0) {
    return (
      <EmptyState
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {hasTaskFilters ? (
              <Button onClick={onClearFilters} variant="secondary">
                {clearFiltersLabel}
              </Button>
            ) : null}
            <Button disabled={!canManageTasks} onClick={onAddTask}>
              {t("action.addTask")}
            </Button>
          </div>
        }
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
    );
  }

  return (
    <>
      <div className="grid gap-2 md:hidden" data-testid="task-mobile-list">
        {filteredTasks.map((task) => (
          <div
            key={task.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/45 p-3"
            data-task-id={task.id}
            data-testid="task-card"
          >
            <div className="flex items-start gap-3">
              <input
                checked={selectedIds.includes(task.id)}
                className="mt-0.5 h-5 w-5 shrink-0"
                onChange={() => toggleTask(task.id)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-5 text-[var(--ink)]">{task.title}</p>
                  <Badge className={taskStatusMeta[task.status].className + " shrink-0 px-1.5 py-0.5 text-[10px]"}>
                    {enumLabel("taskStatus", task.status)}
                  </Badge>
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <p className="truncate">{projectNameById[task.projectId]}</p>
                  <p>{task.assignee?.name || "-"}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span>{formatDateLocalized(task.dueDate, "d MMM")}</span>
                    <Badge className={priorityMeta[task.priority].className + " px-1.5 py-0.5 text-[10px]"}>
                      {enumLabel("priority", task.priority)}
                    </Badge>
                  </div>
                  <TaskDependencyBadges compact task={task} />
                  <Button
                    className="h-7 w-full px-2 text-[11px]"
                    onClick={() => setDependencyTaskId((current) => (current === task.id ? null : task.id))}
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

      <div className="-mx-3 hidden overflow-x-auto px-3 sm:mx-0 sm:px-0 md:block" data-testid="task-table">
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
              <TableRow key={task.id} className="group" data-task-id={task.id} data-testid="task-row">
                <TableCell className="py-1.5">
                  <input
                    checked={selectedIds.includes(task.id)}
                    className="h-5 w-5"
                    onChange={() => toggleTask(task.id)}
                    type="checkbox"
                  />
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="max-w-[240px]">
                    <p className="truncate text-xs font-medium">{task.title}</p>
                    <TaskDependencyBadges compact task={task} />
                    <Button
                      className="mt-2 h-7 px-2 text-[11px]"
                      onClick={() => setDependencyTaskId((current) => (current === task.id ? null : task.id))}
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
                  <Badge className={taskStatusMeta[task.status].className + " px-1.5 py-0.5 text-[10px]"}>
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
                  <Badge className={priorityMeta[task.priority].className + " px-1.5 py-0.5 text-[10px]"}>
                    {enumLabel("priority", task.priority)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
