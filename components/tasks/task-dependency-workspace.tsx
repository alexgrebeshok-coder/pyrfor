"use client";

import { AlertTriangle, ArrowRight, Link2, X } from "lucide-react";

import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { TaskDependencyManager } from "@/components/tasks/task-dependency-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import type { Task } from "@/lib/types";

interface TaskDependencyWorkspaceProps {
  task: Task;
  projectName?: string;
  onClose?: () => void;
  onDependenciesUpdated?: () => void | Promise<void>;
  readOnly?: boolean;
}

export function TaskDependencyWorkspace({
  task,
  projectName,
  onClose,
  onDependenciesUpdated,
  readOnly = false,
}: TaskDependencyWorkspaceProps) {
  const { enumLabel, formatDateLocalized, locale } = useLocale();
  const blockingDependencies = task.dependencySummary?.blockingDependencies ?? [];
  const labels =
    locale === "ru"
      ? {
          assignee: "Исполнитель",
          blocking: "Блокирующие предшественники",
          close: "Закрыть",
          dueDate: "Срок",
          emptyBlocking:
            "Сейчас у задачи нет активных блокирующих предшественников. Ниже можно менять связи и сразу видеть downstream impact.",
          dependencyType: "Тип связи",
          description:
            "Управляйте предшественниками и downstream impact для выбранной задачи в живом workflow, а не в отдельном оторванном экране.",
          project: "Проект",
          readOnly:
            "Сейчас это read-only workspace. Менять зависимости и статусы задач могут только роли с правом MANAGE_TASKS.",
          title: "Dependency workspace",
          unknownAssignee: "Не назначен",
        }
      : locale === "zh"
        ? {
            assignee: "负责人",
            blocking: "阻塞前置任务",
            close: "关闭",
            dueDate: "截止日期",
            emptyBlocking:
              "当前没有 активных阻塞前置任务。你可以在下方直接调整依赖并查看 downstream impact。",
            dependencyType: "依赖类型",
            description:
              "在真实任务流程中管理前置任务与 downstream impact，而不是跳到一个脱离上下文的单独页面。",
            project: "项目",
            readOnly:
              "当前是只读 workspace。只有拥有 MANAGE_TASKS 权限的角色才能修改依赖和任务状态。",
            title: "Dependency workspace",
            unknownAssignee: "未指派",
          }
        : {
            assignee: "Assignee",
            blocking: "Blocking predecessors",
            close: "Close",
            dueDate: "Due date",
            emptyBlocking:
              "This task has no active blocking predecessors right now. You can still adjust dependencies below and review downstream impact in the same workflow.",
            dependencyType: "Dependency type",
            description:
              "Manage predecessors and downstream impact for the selected task in a live workflow instead of a detached one-off screen.",
            project: "Project",
            readOnly:
              "This workspace is currently read-only. Dependency edits and task-status changes require MANAGE_TASKS.",
            title: "Dependency workspace",
            unknownAssignee: "Unassigned",
          };

  return (
    <Card
      className="border-[var(--line-strong)] bg-[var(--panel-soft)]/65 p-4 shadow-[0_18px_40px_rgba(15,23,42,.06)]"
      data-testid="task-dependency-workspace"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            <Link2 className="h-4 w-4 text-[var(--accent)]" />
            <span>{labels.title}</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-[var(--ink)]">{task.title}</h3>
            <p className="max-w-3xl text-sm text-[var(--ink-soft)]">{labels.description}</p>
          </div>
        </div>
        {onClose ? (
          <Button onClick={onClose} size="sm" variant="ghost">
            <X className="h-4 w-4" />
            {labels.close}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <div className="rounded-[20px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{projectName ?? `${labels.project}: —`}</Badge>
              <Badge variant="neutral">{enumLabel("taskStatus", task.status)}</Badge>
              <Badge variant="neutral">{enumLabel("priority", task.priority)}</Badge>
            </div>

            <div className="mt-3 grid gap-2 text-sm text-[var(--ink-soft)]">
              <p>
                <span className="font-medium text-[var(--ink)]">{labels.project}:</span>{" "}
                {projectName ?? "—"}
              </p>
              <p>
                <span className="font-medium text-[var(--ink)]">{labels.assignee}:</span>{" "}
                {task.assignee?.name || labels.unknownAssignee}
              </p>
              <p>
                <span className="font-medium text-[var(--ink)]">{labels.dueDate}:</span>{" "}
                {formatDateLocalized(task.dueDate, "d MMM yyyy")}
              </p>
            </div>

            <TaskDependencyBadges task={task} />
          </div>

          {blockingDependencies.length > 0 ? (
            <div className="rounded-[20px] border border-amber-500/20 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                <span>{labels.blocking}</span>
              </div>
              <div className="mt-3 grid gap-2">
                {blockingDependencies.map((dependency) => (
                  <div
                    key={dependency.id}
                    className="rounded-[14px] border border-amber-500/15 bg-white/70 p-3 dark:bg-black/10"
                  >
                    <div className="flex items-start gap-2">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-200" />
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-[var(--ink)]">{dependency.title}</p>
                        <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                          <Badge variant="warning" className="text-[10px]">
                            {enumLabel("taskStatus", dependency.status)}
                          </Badge>
                          <span>
                            {labels.dependencyType}: {dependency.type.replaceAll("_", " ")}
                          </span>
                          <span>
                            {labels.dueDate}: {formatDateLocalized(dependency.dueDate, "d MMM")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-secondary)] p-4 text-sm text-[var(--ink-soft)]">
              {labels.emptyBlocking}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          {readOnly ? (
            <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              {labels.readOnly}
            </div>
          ) : null}
          <TaskDependencyManager
            onUpdated={onDependenciesUpdated}
            projectId={task.projectId}
            readOnly={readOnly}
            taskId={task.id}
          />
        </div>
      </div>
    </Card>
  );
}
