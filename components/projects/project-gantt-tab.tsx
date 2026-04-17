"use client";

import { Fragment, useMemo } from "react";
import {
  eachWeekOfInterval,
  endOfWeek,
  isAfter,
  isBefore,
  parseISO,
  startOfWeek,
} from "date-fns";

import type { ProjectGanttApiResponse } from "@/components/gantt/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import type { Milestone, Task } from "@/lib/types";

function getOverlapIndex(
  itemStart: Date,
  itemEnd: Date,
  boundaries: { start: Date; end: Date }[]
) {
  const startIndex = boundaries.findIndex(
    (boundary) => !isAfter(boundary.start, itemEnd) && !isBefore(boundary.end, itemStart)
  );

  if (startIndex === -1) return null;

  let endIndex = startIndex;
  for (let index = startIndex; index < boundaries.length; index += 1) {
    if (
      !isAfter(boundaries[index].start, itemEnd) &&
      !isBefore(boundaries[index].end, itemStart)
    ) {
      endIndex = index;
    }
  }

  return { startIndex, endIndex };
}

type GanttStatus = "completed" | "at-risk" | "planning" | "active";

const normalizeGanttStatus = (status?: string): GanttStatus => {
  if (status === "done") return "completed";
  if (status === "blocked") return "at-risk";
  if (status === "todo") return "planning";
  return "active";
};

export interface ProjectGanttTabProps {
  ganttLoading: boolean;
  ganttSnapshot?: ProjectGanttApiResponse;
  projectMilestones: Milestone[];
  projectTasks: Task[];
  projectDates?: { start?: string; end?: string };
}

export function ProjectGanttTab({
  ganttLoading,
  ganttSnapshot,
  projectMilestones,
  projectTasks,
  projectDates,
}: ProjectGanttTabProps) {
  const { enumLabel, formatDateLocalized, t } = useLocale();

  const apiGanttItems = useMemo(
    () =>
      (ganttSnapshot?.tasks ?? []).map((task) => ({
        id: task.id,
        label: task.name,
        start: task.start,
        end: task.end,
        status: normalizeGanttStatus(task.type),
        meta: `${Math.round(task.progress ?? 0)}%`,
        kind: "task" as const,
      })),
    [ganttSnapshot]
  );

  const fallbackGanttItems = useMemo(
    () => [
      ...projectMilestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.name,
        start: milestone.start,
        end: milestone.end,
        status: milestone.status,
        meta: `${milestone.progress}%`,
        kind: "milestone" as const,
      })),
      ...projectTasks.map((task) => ({
        id: task.id,
        label: task.title,
        start: task.createdAt,
        end: task.dueDate,
        status:
          task.status === "done"
            ? ("completed" as const)
            : task.status === "blocked"
              ? ("at-risk" as const)
              : task.status === "todo"
                ? ("planning" as const)
                : ("active" as const),
        meta: enumLabel("taskStatus", task.status),
        kind: "task" as const,
      })),
    ],
    [enumLabel, projectMilestones, projectTasks]
  );

  const ganttItems = apiGanttItems.length ? apiGanttItems : fallbackGanttItems;

  const ganttBounds = useMemo(() => {
    const fallbackStart = projectDates?.start
      ? parseISO(projectDates.start)
      : new Date();
    const fallbackEnd = projectDates?.end
      ? parseISO(projectDates.end)
      : new Date();

    if (!ganttItems.length) {
      return {
        start: startOfWeek(fallbackStart, { weekStartsOn: 1 }),
        end: endOfWeek(fallbackEnd, { weekStartsOn: 1 }),
      };
    }

    const minStart = ganttItems.reduce((min, item) => {
      const date = parseISO(item.start);
      return isBefore(date, min) ? date : min;
    }, fallbackStart);
    const maxEnd = ganttItems.reduce((max, item) => {
      const date = parseISO(item.end);
      return isAfter(date, max) ? date : max;
    }, fallbackEnd);

    return {
      start: startOfWeek(minStart, { weekStartsOn: 1 }),
      end: endOfWeek(maxEnd, { weekStartsOn: 1 }),
    };
  }, [ganttItems, projectDates?.start, projectDates?.end]);

  const timelineColumns = useMemo(
    () =>
      eachWeekOfInterval(
        { start: ganttBounds.start, end: ganttBounds.end },
        { weekStartsOn: 1 }
      ),
    [ganttBounds]
  );

  const boundaries = useMemo(
    () =>
      timelineColumns.map((column) => ({
        start: startOfWeek(column, { weekStartsOn: 1 }),
        end: endOfWeek(column, { weekStartsOn: 1 }),
      })),
    [timelineColumns]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("project.gantt")}</CardTitle>
        <CardDescription>{t("gantt.description")}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {ganttLoading ? (
          <div className="min-h-[260px] flex items-center justify-center">
            <p className="text-sm text-[var(--ink-muted)]">Загрузка диаграммы Ганта…</p>
          </div>
        ) : !ganttItems.length ? (
          <div className="min-h-[260px] flex items-center justify-center">
            <p className="text-sm text-[var(--ink-muted)]">Нет задач для диаграммы Ганта.</p>
          </div>
        ) : (
          <div
            className="min-w-[1080px]"
            style={{
              display: "grid",
              gridTemplateColumns: `280px repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
            }}
          >
            <div className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-4 font-semibold text-[var(--ink)]">
              {t("gantt.item")}
            </div>
            {timelineColumns.map((column) => (
              <div
                key={column.toISOString()}
                className="border-b border-r border-[var(--line)] bg-[var(--panel-soft)]/70 px-2 py-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]"
              >
                {formatDateLocalized(column.toISOString(), "d MMM")}
              </div>
            ))}

            {ganttItems.map((item) => {
              const overlap = getOverlapIndex(
                parseISO(item.start),
                parseISO(item.end),
                boundaries
              );

              return (
                <Fragment key={item.id}>
                  <div
                    className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-4"
                    data-item-id={item.id}
                    data-task-id={item.kind === "task" ? item.id : undefined}
                    data-testid={
                      item.kind === "task" ? "gantt-task-item" : "gantt-project-item"
                    }
                  >
                    <div className="font-medium text-[var(--ink)]">{item.label}</div>
                    <div className="text-sm text-[var(--ink-soft)]">{item.meta}</div>
                  </div>
                  <div
                    className="relative col-span-full border-b border-[var(--line)]"
                    style={{ gridColumn: `2 / span ${timelineColumns.length}` }}
                  >
                    <div
                      className="absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
                      }}
                    >
                      {timelineColumns.map((column) => (
                        <div
                          key={`${item.id}-${column.toISOString()}`}
                          className="border-r border-[var(--line)]/80"
                        />
                      ))}
                    </div>
                    {overlap ? (
                      <div
                        className="relative grid h-[72px]"
                        style={{
                          gridTemplateColumns: `repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
                        }}
                      >
                        <div
                          className="z-[1] m-3 flex items-center rounded-[10px] px-4 text-sm font-semibold text-white"
                          style={{
                            gridColumn: `${overlap.startIndex + 1} / ${overlap.endIndex + 2}`,
                            background:
                              item.status === "at-risk"
                                ? "linear-gradient(135deg,#fb7185 0%,#f97316 100%)"
                                : item.status === "completed"
                                  ? "linear-gradient(135deg,#10b981 0%,#0f766e 100%)"
                                  : "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)",
                          }}
                        >
                          {enumLabel("projectStatus", item.status)}
                        </div>
                      </div>
                    ) : (
                      <div className="h-[72px]" />
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
