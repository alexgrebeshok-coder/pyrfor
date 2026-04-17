"use client";

import type { Dispatch, SetStateAction } from "react";
import { Link2 } from "lucide-react";

import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { TaskDependencyWorkspace } from "@/components/tasks/task-dependency-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import type { Task, TaskStatus } from "@/lib/types";
import { cn, priorityMeta, taskStatusMeta } from "@/lib/utils";

const columnOrder: TaskStatus[] = ["todo", "in-progress", "blocked", "done"];

const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: "in-progress",
  "in-progress": "done",
  blocked: "in-progress",
};

export interface ProjectTasksTabProps {
  projectTasks: Task[];
  canManageTasks: boolean;
  dependencyTaskId: string | null;
  setDependencyTaskId: Dispatch<SetStateAction<string | null>>;
  dependencyTask: Task | null;
  projectName: string;
  mutateTasks: () => Promise<unknown>;
  onAddTask: () => void;
  updateTaskStatus: (taskIds: string[], status: TaskStatus) => void;
}

export function ProjectTasksTab({
  projectTasks,
  canManageTasks,
  dependencyTaskId,
  setDependencyTaskId,
  dependencyTask,
  projectName,
  mutateTasks,
  onAddTask,
  updateTaskStatus,
}: ProjectTasksTabProps) {
  const { enumLabel, formatDateLocalized, locale, t } = useLocale();

  return (
    <>
      <Card className="mb-4">
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="font-medium text-[var(--ink)]">{t("project.tasks")}</p>
            <p className="text-sm text-[var(--ink-soft)]">{t("project.taskBoardDescription")}</p>
          </div>
          <Button
            data-testid="create-task-button"
            disabled={!canManageTasks}
            onClick={onAddTask}
          >
            {t("action.addTask")}
          </Button>
        </CardContent>
      </Card>
      {dependencyTask ? (
        <div className="mb-4">
          <TaskDependencyWorkspace
            onClose={() => setDependencyTaskId(null)}
            onDependenciesUpdated={async () => {
              await mutateTasks();
            }}
            projectName={projectName}
            readOnly={!canManageTasks}
            task={dependencyTask}
          />
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-4">
        {columnOrder.map((status) => (
          <Card key={status} className="bg-[var(--panel-soft)]/55">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{enumLabel("taskStatus", status)}</CardTitle>
                <Badge className={cn("ring-1", taskStatusMeta[status].className)}>
                  {projectTasks.filter((task) => task.status === status).length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {projectTasks
                .filter((task) => task.status === status)
                .map((task) => (
                  <div
                    key={task.id}
                    className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel-strong)] p-4 shadow-[0_10px_28px_rgba(15,23,42,.06)]"
                    data-testid="project-task-card"
                    data-task-id={task.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--ink)]">{task.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-soft)]">{task.description}</p>
                      </div>
                      <Badge className={cn("ring-1", priorityMeta[task.priority].className)}>
                        {enumLabel("priority", task.priority)}
                      </Badge>
                    </div>
                    <div className="mt-4 text-sm text-[var(--ink-soft)]">
                      <div>{task.assignee?.name || "-"}</div>
                      <div>
                        {t("tasks.dueDate")}{" "}
                        {formatDateLocalized(task.dueDate, "d MMM yyyy")}
                      </div>
                    </div>
                    <TaskDependencyBadges task={task} />
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      variant={dependencyTaskId === task.id ? "secondary" : "outline"}
                      onClick={() =>
                        setDependencyTaskId((current) => (current === task.id ? null : task.id))
                      }
                    >
                      <Link2 className="h-4 w-4" />
                      {locale === "ru"
                        ? "Зависимости"
                        : locale === "zh"
                          ? "依赖关系"
                          : "Dependencies"}
                    </Button>
                    {nextStatus[task.status] ? (
                    <Button
                      className="mt-4 w-full"
                      disabled={!canManageTasks}
                      size="sm"
                      variant="secondary"
                      data-testid="project-task-status-button"
                        data-task-id={task.id}
                        onClick={() =>
                          updateTaskStatus([task.id], nextStatus[task.status] as TaskStatus)
                        }
                      >
                        {t("action.updateStatus")}{" "}
                        {enumLabel(
                          "taskStatus",
                          nextStatus[task.status] as TaskStatus
                        )}
                      </Button>
                    ) : null}
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
