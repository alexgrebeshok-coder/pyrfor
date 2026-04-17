"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, fieldStyles } from "@/components/ui/field";
import { useDashboard } from "@/components/dashboard-provider";
import { useLocale } from "@/contexts/locale-context";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import { getRelativeIsoDate } from "@/lib/date";
import type { Priority, TaskStatus } from "@/lib/types";

export function KanbanAddCard({
  columnId,
  projectId,
}: {
  columnId: TaskStatus;
  projectId: string | null;
}) {
  const { addTask, team } = useDashboard();
  const { enumLabel, locale, t } = useLocale();
  const { allowed: canManageTasks } = usePlatformPermission("MANAGE_TASKS");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState(getRelativeIsoDate(7));
  const [priority, setPriority] = useState<Priority>("medium");
  const assignees = useMemo(() => team.map((member) => member.name), [team]);

  const reset = () => {
    setTitle("");
    setAssignee("");
    setDueDate(getRelativeIsoDate(7));
    setPriority("medium");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        className="w-full justify-start"
        disabled={!projectId || !canManageTasks}
        onClick={() => setOpen(true)}
        variant="ghost"
      >
        <Plus className="h-4 w-4" />
        {!projectId
          ? t("kanban.noProject")
          : canManageTasks
            ? t("kanban.addInline")
            : locale === "ru"
              ? "Нет прав на создание задач"
              : locale === "zh"
                ? "无权创建任务"
                : "No permission to create tasks"}
      </Button>
    );
  }

  return (
    <div className="grid gap-3 rounded-[22px] border border-dashed border-[var(--line)] bg-[color:var(--surface-panel)] p-4">
      <Input
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t("placeholder.taskName")}
        value={title}
      />
      <select
        className={fieldStyles}
        onChange={(event) => setAssignee(event.target.value)}
        value={assignee}
      >
        <option value="">{t("field.unassigned")}</option>
        {assignees.map((member) => (
          <option key={member} value={member}>
            {member}
          </option>
        ))}
      </select>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          onChange={(event) => setDueDate(event.target.value)}
          type="date"
          value={dueDate}
        />
        <select
          className={fieldStyles}
          onChange={(event) => setPriority(event.target.value as Priority)}
          value={priority}
        >
          <option value="low">{enumLabel("priority", "low")}</option>
          <option value="medium">{enumLabel("priority", "medium")}</option>
          <option value="high">{enumLabel("priority", "high")}</option>
          <option value="critical">{enumLabel("priority", "critical")}</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!projectId || !title.trim() || !canManageTasks}
          onClick={() => {
            if (!projectId || !title.trim() || !canManageTasks) return;

            addTask({
              projectId,
              title: title.trim(),
              assignee,
              dueDate,
              priority,
              status: columnId,
              description: t("kanban.addInlineDescription"),
            });
            reset();
          }}
          size="sm"
        >
          <Plus className="h-4 w-4" />
          {t("action.addTask")}
        </Button>
        <Button onClick={reset} size="sm" variant="outline">
          <X className="h-4 w-4" />
          {t("action.cancel")}
        </Button>
      </div>
    </div>
  );
}
