"use client";

import { Button } from "@/components/ui/button";
import type { GanttRow } from "@/components/gantt/types";
import { cn, formatCurrency, initials } from "@/lib/utils";

interface GanttTableProps {
  rows: GanttRow[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onShiftTask: (row: Extract<GanttRow, { kind: "task" }>, deltaDays: number) => void;
  onAdjustProgress: (row: Extract<GanttRow, { kind: "task" }>, deltaPercent: number) => void;
  formatDateLocalized: (date: string, pattern?: string) => string;
}

export function GanttTable({
  rows,
  selectedTaskId,
  onSelectTask,
  onShiftTask,
  onAdjustProgress,
  formatDateLocalized,
}: GanttTableProps) {
  return (
    <div className="min-w-[460px] border-r border-[var(--line)] bg-[var(--surface-panel)]">
      <div className="grid grid-cols-[72px_minmax(220px,1fr)_82px_82px_70px_58px_62px_112px] border-b border-[var(--line)] bg-[var(--panel-soft)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        <div className="px-3 py-3">WBS</div>
        <div className="px-3 py-3">Задача</div>
        <div className="px-2 py-3 text-right">Старт</div>
        <div className="px-2 py-3 text-right">Финиш</div>
        <div className="px-2 py-3 text-right">Длит.</div>
        <div className="px-2 py-3 text-right">%</div>
        <div className="px-2 py-3 text-right">Float</div>
        <div className="px-3 py-3">Ресурсы</div>
      </div>

      {rows.map((row) => {
        const selected = row.kind === "task" && row.id === selectedTaskId;
        const assignmentLabels = row.assignments
          .map((assignment) => assignment.memberName ?? assignment.equipmentName ?? null)
          .filter((label): label is string => Boolean(label))
          .slice(0, 3);

        return (
          <div
            key={row.id}
            className={cn(
              "grid grid-cols-[72px_minmax(220px,1fr)_82px_82px_70px_58px_62px_112px] border-b border-[var(--line)] text-sm",
              row.kind === "project" ? "bg-[var(--panel-soft)]/35" : "bg-[var(--surface-panel)]",
              selected ? "ring-1 ring-inset ring-[var(--brand)]" : undefined
            )}
          >
            <div className="px-3 py-3 text-[var(--ink-soft)]">{row.wbs ?? (row.kind === "project" ? "PRJ" : "—")}</div>
            <div className="min-w-0 px-3 py-3">
              <button
                className="w-full text-left"
                onClick={() => row.kind === "task" && onSelectTask(row.id)}
                type="button"
              >
                <div
                  className={cn(
                    "truncate font-medium text-[var(--ink)]",
                    row.isCritical ? "text-rose-600" : undefined
                  )}
                  style={{ paddingLeft: `${row.level * 14}px` }}
                >
                  {row.kind === "project" ? "▣ " : row.isMilestone ? "◆ " : ""}
                  {row.title}
                </div>
                <div className="truncate text-xs text-[var(--ink-muted)]">
                  {row.kind === "project"
                    ? "Сводка проекта"
                    : `${row.isManualSchedule ? "Manual" : "Auto"} · ${row.status}`}
                </div>
              </button>

              {selected ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button onClick={() => onShiftTask(row, -1)} size="sm" variant="outline">
                    -1д
                  </Button>
                  <Button onClick={() => onShiftTask(row, 1)} size="sm" variant="outline">
                    +1д
                  </Button>
                  <Button onClick={() => onAdjustProgress(row, -10)} size="sm" variant="secondary">
                    -10%
                  </Button>
                  <Button onClick={() => onAdjustProgress(row, 10)} size="sm" variant="secondary">
                    +10%
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="px-2 py-3 text-right text-[var(--ink)]">
              {formatDateLocalized(row.start, "dd MMM")}
            </div>
            <div className="px-2 py-3 text-right text-[var(--ink)]">
              {formatDateLocalized(row.end, "dd MMM")}
            </div>
            <div className="px-2 py-3 text-right text-[var(--ink)]">{row.durationDays}д</div>
            <div className="px-2 py-3 text-right text-[var(--ink)]">{row.progress}%</div>
            <div className="px-2 py-3 text-right text-[var(--ink)]">{row.totalFloatDays}д</div>
            <div className="flex min-w-0 items-center gap-1 px-3 py-3">
              {assignmentLabels.length ? (
                assignmentLabels.map((label) => (
                  <span
                    key={`${row.id}-${label}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--panel-soft)] text-[10px] font-semibold text-[var(--ink)]"
                    title={label}
                  >
                    {initials(label)}
                  </span>
                ))
              ) : row.kind === "task" ? (
                <span className="text-xs text-[var(--ink-muted)]">
                  {row.assignments.length
                    ? formatCurrency(
                        row.assignments.reduce((sum, assignment) => sum + ((assignment.costRate ?? 0) * (assignment.actualHours ?? assignment.plannedHours ?? 0)), 0)
                      )
                    : "—"}
                </span>
              ) : (
                <span className="text-xs text-[var(--ink-muted)]">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
