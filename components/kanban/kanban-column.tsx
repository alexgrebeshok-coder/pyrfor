"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { KanbanTaskCard } from "./kanban-task-card";
import type { Column, Task } from "@/lib/types";

interface KanbanColumnProps {
  column: Column;
  tasks: Task[];
}

export const KanbanColumn = React.memo(function KanbanColumn({ column, tasks }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <Card
      ref={setNodeRef}
      className={`flex w-60 min-w-[256px] flex-col ${
        isOver ? "ring-2 ring-[var(--accent)]" : ""
      }`}
      data-testid="kanban-column"
      data-column-id={column.id}
    >
      {/* Column Header - Compact */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-2 py-1.5">
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: column.color || "#6b7280" }}
        />
        <h3 className="text-xs font-medium">{column.title}</h3>
        <span className="ml-auto text-[10px] text-[var(--ink-muted)]">
          {tasks.length}
        </span>
      </div>

      {/* Tasks */}
      <div className="flex-1 overflow-y-auto p-1.5" role="list" aria-label={`Задачи в колонке ${column.title}`}>
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {tasks.map((task) => (
              <KanbanTaskCard key={task.id} task={task} />
            ))}
          </div>
        </SortableContext>

        {tasks.length === 0 && (
          <p className="py-3 text-center text-[10px] text-[var(--ink-muted)]">
            Нет задач
          </p>
        )}
      </div>
    </Card>
  );
});
