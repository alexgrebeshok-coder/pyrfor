"use client";

import { Fragment, useMemo, useState } from "react";
import {
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  isAfter,
  isBefore,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { getTodayDate } from "@/lib/date";

type Scale = "week" | "month";
type GanttStatus = "completed" | "at-risk" | "planning" | "active";

interface GanttApiProject {
  id: string;
  name: string;
  start: string;
  end: string;
  status: string;
  progress: number | null;
}

interface GanttApiTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies: string[];
  type?: string;
  projectId?: string;
}

interface GanttApiResponse {
  projects: GanttApiProject[];
  tasks: GanttApiTask[];
}

interface DisplayItem {
  id: string;
  label: string;
  start: string;
  end: string;
  status: string;
  meta: string;
  dependencies?: string[];
  kind: "project" | "task";
}

const ganttFetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Gantt data");
  }
  return response.json();
};

const normalizeGanttStatus = (status?: string): GanttStatus => {
  if (status === "done") {
    return "completed";
  }
  if (status === "blocked" || status === "at-risk" || status === "at_risk") {
    return "at-risk";
  }
  if (status === "todo") {
    return "planning";
  }
  return "active";
};

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

export function GanttPage() {
  const { enumLabel, formatDateLocalized, t } = useLocale();
  const [scale, setScale] = useState<Scale>("month");
  const [projectFilter, setProjectFilter] = useState<"all" | string>("all");

  const endpoint = projectFilter === "all" ? "/api/gantt" : `/api/gantt?projectId=${projectFilter}`;
  const { data, error } = useSWR<GanttApiResponse>(endpoint, ganttFetcher);

  const projectOptions = useMemo(() => data?.projects ?? [], [data?.projects]);

  const projectItems = useMemo(
    () =>
      projectOptions.map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        start: project.start,
        end: project.end,
        status: project.status,
        meta: `${Math.round(Math.max(0, Math.min(100, project.progress ?? 0)))}%`,
        kind: "project" as const,
      })),
    [projectOptions]
  );

  const taskItems = useMemo(
    () =>
      (data?.tasks ?? []).map((task) => ({
        id: task.id,
        label: task.name,
        start: task.start,
        end: task.end,
        status: task.type ?? "active",
        meta: `${Math.round(Math.max(0, Math.min(100, task.progress ?? 0)))}%`,
        dependencies: task.dependencies ?? [],
        kind: "task" as const,
      })),
    [data?.tasks]
  );

  const items = useMemo(() => [...projectItems, ...taskItems], [projectItems, taskItems]);

  const taskNameMap = useMemo(() => {
    const map = new Map<string, string>();
    data?.tasks?.forEach((task) => {
      map.set(task.id, task.name);
    });
    return map;
  }, [data?.tasks]);

  const dependencyLabels = useMemo(() => {
    const map = new Map<string, string[]>();
    (data?.tasks ?? []).forEach((task) => {
      if (!task.dependencies?.length) return;
      map.set(
        task.id,
        task.dependencies.map((dependencyId) => taskNameMap.get(dependencyId) ?? dependencyId)
      );
    });
    return map;
  }, [data?.tasks, taskNameMap]);

  const overallStart = useMemo(() => {
    if (!items.length) {
      return startOfMonth(getTodayDate());
    }
    return startOfMonth(
      items.reduce((min, item) => {
        const candidate = parseISO(item.start);
        return isBefore(candidate, min) ? candidate : min;
      }, parseISO(items[0].start))
    );
  }, [items]);

  const overallEnd = useMemo(() => {
    if (!items.length) {
      const fallback = new Date();
      fallback.setFullYear(fallback.getFullYear() + 1);
      return endOfMonth(fallback);
    }
    const maxDate = items.reduce((max, item) => {
      const candidate = parseISO(item.end);
      return isAfter(candidate, max) ? candidate : max;
    }, parseISO(items[0].end));

    const oneYearAhead = new Date();
    oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);
    return endOfMonth(isAfter(maxDate, oneYearAhead) ? maxDate : oneYearAhead);
  }, [items]);

  const columns =
    scale === "week"
      ? eachWeekOfInterval({ start: overallStart, end: overallEnd }, { weekStartsOn: 1 })
      : eachMonthOfInterval({ start: overallStart, end: overallEnd });

  const columnBoundaries = columns.map((column) =>
    scale === "week"
      ? { start: startOfWeek(column, { weekStartsOn: 1 }), end: endOfWeek(column, { weekStartsOn: 1 }) }
      : { start: startOfMonth(column), end: endOfMonth(column) }
  );

  const today = getTodayDate();
  const todayIndex = columnBoundaries.findIndex(
    (boundary) => !isBefore(today, boundary.start) && !isAfter(today, boundary.end)
  );

  const isLoading = !data && !error;
  const hasData = !!items.length;

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader className="flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle className="text-lg tracking-[-0.04em]">{t("gantt.title")}</CardTitle>
            <p className="text-xs leading-5 text-[var(--ink-soft)]">{t("gantt.description")}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <select
              className={`${fieldStyles} h-9 text-sm`}
              onChange={(event) => setProjectFilter(event.target.value as "all" | string)}
              value={projectFilter}
            >
              <option value="all">{t("filters.allProjects")}</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              className={`${fieldStyles} h-9 text-sm`}
              onChange={(event) => setScale(event.target.value as Scale)}
              value={scale}
            >
              <option value="week">{t("filters.week")}</option>
              <option value="month">{t("filters.month")}</option>
            </select>
          </div>
        </CardHeader>
      </Card>

      <Card>
        {isLoading ? (
          <CardContent className="py-6 text-center text-sm text-[var(--ink-muted)]">
            Загрузка диаграммы Ганта...
          </CardContent>
        ) : error ? (
          <CardContent className="py-6 text-center text-sm text-[var(--ink-muted)]">
            Не удалось загрузить диаграмму Ганта.
          </CardContent>
        ) : !hasData ? (
          <CardContent className="py-6 text-center text-sm text-[var(--ink-muted)]">
            Нет данных для диаграммы Ганта.
          </CardContent>
        ) : (
          <CardContent className="overflow-x-auto p-0">
            <div
              className="min-w-[960px]"
              style={{
                display: "grid",
                gridTemplateColumns: `220px repeat(${columns.length}, minmax(64px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-2.5 font-semibold text-[var(--ink)]">
                {t("gantt.item")}
              </div>
              {columns.map((column, index) => (
                <div
                  key={column.toISOString()}
                  className="border-b border-r border-[var(--line)] bg-[var(--panel-soft)]/70 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                >
                  {scale === "week"
                    ? formatDateLocalized(column.toISOString(), "dd MMM")
                    : formatDateLocalized(column.toISOString(), "MMM yyyy")}
                  {todayIndex === index ? (
                    <div className="mt-2 rounded-full bg-rose-500 px-2 py-1 text-[10px] text-white">
                      {t("gantt.today")}
                    </div>
                  ) : null}
                </div>
              ))}

              {items.map((item) => {
                const overlap = getOverlapIndex(parseISO(item.start), parseISO(item.end), columnBoundaries);
                const dependencyNames = dependencyLabels.get(item.id) ?? [];

                return (
                  <Fragment key={item.id}>
                    <div
                    className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-2.5"
                      data-testid={item.kind === "task" ? "gantt-task-item" : "gantt-project-item"}
                      data-task-id={item.kind === "task" ? item.id : undefined}
                      data-item-id={item.id}
                    >
                      <div className="truncate font-medium text-[var(--ink)]">{item.label}</div>
                      <div className="text-xs text-[var(--ink-soft)]">{item.meta}</div>
                      {dependencyNames.length ? (
                        <div className="mt-2 line-clamp-2 text-[10px] uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                          Depends on: {dependencyNames.join(", ")}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="relative col-span-full border-b border-[var(--line)]"
                      style={{ gridColumn: `2 / span ${columns.length}` }}
                    >
                      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(64px, 1fr))` }}>
                        {columns.map((column) => (
                          <div key={`${item.id}-${column.toISOString()}`} className="border-r border-[var(--line)]" />
                        ))}
                      </div>
                      {overlap ? (
                        <div
                          className="relative grid h-[52px]"
                          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(64px, 1fr))` }}
                        >
                          <div
                            className="z-[1] m-2 flex items-center rounded-[10px] px-2.5 text-xs font-semibold text-white"
                            style={{
                              gridColumn: `${overlap.startIndex + 1} / ${overlap.endIndex + 2}`,
                              background:
                                item.kind === "project"
                                  ? "linear-gradient(135deg, #0f172a 0%, #2563eb 100%)"
                                  : `linear-gradient(135deg, ${
                                      normalizeGanttStatus(item.status) === "completed"
                                        ? "#10b981 0%, #0f766e 100%"
                                        : normalizeGanttStatus(item.status) === "at-risk"
                                          ? "#fb7185 0%, #f97316 100%"
                                          : "#38bdf8 0%, #2563eb 100%"
                                    })`,
                            }}
                          >
                          {item.kind === "project"
                            ? enumLabel("projectStatus", item.status) ?? item.status
                            : enumLabel("taskStatus", item.status) ?? item.status}
                          </div>
                        </div>
                      ) : (
                        <div className="h-[52px]" />
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
