"use client";

import { differenceInCalendarDays, parseISO } from "date-fns";
import { GripVertical } from "lucide-react";

import type { GanttRow } from "@/components/gantt/types";
import type { DragState } from "@/components/gantt/gantt-helpers";
import { ROW_HEIGHT } from "@/components/gantt/gantt-helpers";
import { cn } from "@/lib/utils";

interface GanttChartBarsProps {
  rows: GanttRow[];
  previewByTaskId: Map<string, { start: string; end: string }>;
  timelineStart: Date;
  dayWidth: number;
  showCritical: boolean;
  showBaseline: boolean;
  onDragStart: (state: DragState) => void;
  onSelectTask: (id: string) => void;
}

export function GanttChartBars({
  rows,
  previewByTaskId,
  timelineStart,
  dayWidth,
  showCritical,
  showBaseline,
  onDragStart,
  onSelectTask,
}: GanttChartBarsProps) {
  return (
    <>
      {rows.map((row, index) => {
        const preview = previewByTaskId.get(row.id);
        const start = parseISO(preview?.start ?? row.start);
        const end = parseISO(preview?.end ?? row.end);
        const x = Math.max(0, differenceInCalendarDays(start, timelineStart) * dayWidth);
        const width = row.isMilestone
          ? 18
          : Math.max(dayWidth, (differenceInCalendarDays(end, start) + 1) * dayWidth - 6);
        const y = index * ROW_HEIGHT + 10;
        const barTone =
          row.kind === "project"
            ? "linear-gradient(135deg, #0f172a 0%, #2563eb 100%)"
            : showCritical && row.isCritical
              ? "linear-gradient(135deg, #ef4444 0%, #f97316 100%)"
              : row.status === "done"
                ? "linear-gradient(135deg, #10b981 0%, #0f766e 100%)"
                : row.status === "blocked"
                  ? "linear-gradient(135deg, #ef4444 0%, #7f1d1d 100%)"
                  : "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)";

        function startDrag(event: React.MouseEvent, mode: DragState["mode"]) {
          if (row.kind !== "task") return;
          event.preventDefault();
          onDragStart({
            taskId: row.id,
            projectId: row.projectId,
            mode,
            originStart: row.start,
            originEnd: row.end,
            originClientX: event.clientX,
            deltaDays: 0,
          });
        }

        return (
          <div
            key={row.id}
            className={cn(
              "absolute inset-x-0 border-b border-[var(--line)]/70",
              row.kind === "project" ? "bg-[var(--panel-soft)]/20" : undefined
            )}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
          >
            {showBaseline && row.baselines[0] ? (
              <div
                className="absolute rounded-md border border-dashed border-slate-400/80 bg-slate-300/25"
                style={{
                  left: differenceInCalendarDays(parseISO(row.baselines[0].startDate), timelineStart) * dayWidth,
                  top: row.isMilestone ? 18 : 28,
                  width: row.isMilestone
                    ? 14
                    : Math.max(
                        dayWidth,
                        (differenceInCalendarDays(
                          parseISO(row.baselines[0].finishDate),
                          parseISO(row.baselines[0].startDate)
                        ) +
                          1) *
                          dayWidth -
                          8
                      ),
                  height: row.isMilestone ? 14 : 8,
                  transform: row.isMilestone ? "rotate(45deg)" : undefined,
                }}
              />
            ) : null}

            <div
              className={cn(
                "absolute z-[2] select-none",
                row.kind === "task" ? "cursor-grab active:cursor-grabbing" : undefined
              )}
              style={{ left: x, top: y }}
            >
              {row.isMilestone ? (
                <button
                  className="h-[18px] w-[18px] rounded-[2px] border border-white/50 shadow-sm"
                  onMouseDown={(event) => startDrag(event, "move")}
                  style={{
                    background: barTone,
                    transform: "rotate(45deg)",
                  }}
                  title={`${row.title} · ${row.progress}%`}
                  type="button"
                />
              ) : (
                <div
                  className="group relative h-[22px] rounded-[10px] border border-white/20 shadow-sm"
                  style={{
                    width,
                    background: barTone,
                  }}
                >
                  {row.kind === "task" ? (
                    <>
                      <button
                        aria-label="Resize start"
                        className="absolute inset-y-0 left-0 hidden w-2 cursor-ew-resize rounded-l-[10px] bg-white/20 group-hover:block"
                        onMouseDown={(event) => startDrag(event, "resize-start")}
                        type="button"
                      />
                      <button
                        aria-label="Move task"
                        className="absolute inset-0 flex items-center justify-center gap-1 rounded-[10px] px-2 text-[11px] font-semibold text-white"
                        onMouseDown={(event) => startDrag(event, "move")}
                        onDoubleClick={() => onSelectTask(row.id)}
                        type="button"
                      >
                        <GripVertical className="h-3 w-3 opacity-70" />
                        <span className="truncate">{row.progress}%</span>
                      </button>
                      <button
                        aria-label="Resize end"
                        className="absolute inset-y-0 right-0 hidden w-2 cursor-ew-resize rounded-r-[10px] bg-white/20 group-hover:block"
                        onMouseDown={(event) => startDrag(event, "resize-end")}
                        type="button"
                      />
                    </>
                  ) : (
                    <div className="flex h-full items-center px-3 text-[11px] font-semibold text-white">
                      {row.progress}% · {row.title}
                    </div>
                  )}

                  <div
                    className="absolute left-0 top-0 h-full rounded-[10px] bg-white/20"
                    style={{ width: `${row.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
