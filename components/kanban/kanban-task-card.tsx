"use client";

import React, { useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { Calendar, User } from "lucide-react";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface KanbanTaskCardProps {
  task: Task;
  isDragging?: boolean;
}

// Priority colors - compact style
const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  medium: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
  high: "bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400",
  critical: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
};

export const KanbanTaskCard = React.memo(function KanbanTaskCard({ task, isDragging }: KanbanTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms ease",
  };

  const priorityColor = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium;

  const isOverdue =
    task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done";

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
    }
  }, []);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid="task-card"
      data-task-id={task.id}
      role="listitem"
      aria-label={`Задача: ${task.title}, приоритет: ${task.priority}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-grab p-2 transition-all duration-200",
        "active:cursor-grabbing focus:ring-2 focus:ring-[var(--accent)] focus:outline-none",
        "hover:shadow-md",
        (isDragging || isSortableDragging) && "opacity-50 scale-105 shadow-lg",
        isOverdue && "border-l-2 border-l-red-500"
      )}
    >
      {/* Title - Compact */}
      <h4 className="text-xs font-medium leading-tight truncate mb-1">{task.title}</h4>
      <TaskDependencyBadges compact task={task} />

      {/* Footer - Compact */}
      <div className="flex items-center justify-between">
        {/* Priority */}
        <Badge
          variant="neutral"
          className={`${priorityColor} text-[9px] px-1 py-0.5`}
        >
          {task.priority}
        </Badge>

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
          {task.dueDate && (
            <div className={cn("flex items-center gap-0.5", isOverdue && "text-red-500")}>
              <Calendar className="h-2.5 w-2.5" />
              <span>{new Date(task.dueDate).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
            </div>
          )}
          {task.assignee && (
            <div className="flex items-center gap-0.5">
              <User className="h-2.5 w-2.5" />
              <span>{task.assignee.initials || task.assignee.name.split(" ").map(n => n[0]).join("")}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});
