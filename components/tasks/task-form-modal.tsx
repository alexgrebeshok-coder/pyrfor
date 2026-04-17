"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { getRelativeIsoDate } from "@/lib/date";
import { Priority, TaskStatus } from "@/lib/types";

interface TaskFormValues {
  title: string;
  description: string;
  projectId: string;
  assignee: string;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
}

const createEmptyValues = (projectId?: string): TaskFormValues => ({
  title: "",
  description: "",
  projectId: projectId ?? "",
  assignee: "",
  dueDate: getRelativeIsoDate(30),
  priority: "medium",
  status: "todo",
});

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  canManage?: boolean;
}

export function TaskFormModal({
  open,
  onOpenChange,
  projectId,
  canManage = true,
}: TaskFormModalProps) {
  const { addTask, projects, team } = useDashboard();
  const { enumLabel, locale, t } = useLocale();
  const [values, setValues] = useState<TaskFormValues>(createEmptyValues(projectId));
  const formId = useId();
  const permissionMessage =
    locale === "ru"
      ? "Создание задач доступно только ролям с правом MANAGE_TASKS."
      : locale === "zh"
        ? "只有拥有 MANAGE_TASKS 权限的角色才能创建任务。"
        : "Task creation is available only to roles with MANAGE_TASKS.";

  useEffect(() => {
    if (open) {
      setValues(createEmptyValues(projectId));
    }
  }, [open, projectId]);

  const availableAssignees = useMemo(() => team.map((member) => member.name), [team]);

  const setField = <Key extends keyof TaskFormValues>(
    key: Key,
    value: TaskFormValues[Key]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    if (!canManage || !values.title.trim() || !values.projectId) return;

    addTask({
      projectId: values.projectId,
      title: values.title,
      description: values.description,
      assignee: values.assignee,
      dueDate: values.dueDate,
      priority: values.priority,
      status: values.status,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"
        data-testid="create-task-form"
      >
        <DialogHeader>
          <DialogTitle>{t("form.task.createTitle")}</DialogTitle>
          <DialogDescription>{t("form.task.description")}</DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-4" disabled={!canManage}>
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-title`}>
                  {t("field.name")}
                </label>
                <Input
                  id={`${formId}-task-title`}
                  data-testid="task-title-input"
                  onChange={(event) => setField("title", event.target.value)}
                  placeholder={t("placeholder.taskName")}
                  value={values.title}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-description`}>
                  {t("field.description")}
                </label>
                <Textarea
                  id={`${formId}-task-description`}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder={t("placeholder.projectDescription")}
                  value={values.description}
                />
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/65 p-5">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-project`}>
                  {t("field.project")}
                </label>
                <select
                  id={`${formId}-task-project`}
                  className={fieldStyles}
                  data-testid="task-project-select"
                  onChange={(event) => setField("projectId", event.target.value)}
                  value={values.projectId}
                >
                  <option value="">{t("filters.allProjects")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-assignee`}>
                  {t("field.assignee")}
                </label>
                <select
                  id={`${formId}-task-assignee`}
                  className={fieldStyles}
                  data-testid="task-assignee-select"
                  onChange={(event) => setField("assignee", event.target.value)}
                  value={values.assignee}
                >
                  <option value="">{t("field.unassigned")}</option>
                  {availableAssignees.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-due-date`}>
                    {t("field.dueDate")}
                  </label>
                  <Input
                    id={`${formId}-task-due-date`}
                    data-testid="task-due-date-input"
                    onChange={(event) => setField("dueDate", event.target.value)}
                    type="date"
                    value={values.dueDate}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-priority`}>
                    {t("field.priority")}
                  </label>
                  <select
                    id={`${formId}-task-priority`}
                    className={fieldStyles}
                    onChange={(event) => setField("priority", event.target.value as Priority)}
                    value={values.priority}
                  >
                    <option value="low">{enumLabel("priority", "low")}</option>
                    <option value="medium">{enumLabel("priority", "medium")}</option>
                    <option value="high">{enumLabel("priority", "high")}</option>
                    <option value="critical">{enumLabel("priority", "critical")}</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-task-status`}>
                  {t("field.status")}
                </label>
                <select
                  id={`${formId}-task-status`}
                  className={fieldStyles}
                  onChange={(event) => setField("status", event.target.value as TaskStatus)}
                  value={values.status}
                >
                  <option value="todo">{enumLabel("taskStatus", "todo")}</option>
                  <option value="in-progress">{enumLabel("taskStatus", "in-progress")}</option>
                  <option value="blocked">{enumLabel("taskStatus", "blocked")}</option>
                  <option value="done">{enumLabel("taskStatus", "done")}</option>
                </select>
              </div>
            </div>
          </div>
        </fieldset>

        {!canManage ? (
          <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            {permissionMessage}
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" onClick={() => onOpenChange(false)} variant="ghost">
            {t("action.cancel")}
          </Button>
          <Button
            className="w-full sm:w-auto"
            data-testid="submit-task-button"
            disabled={!canManage}
            onClick={handleSubmit}
          >
            {t("action.addTask")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
