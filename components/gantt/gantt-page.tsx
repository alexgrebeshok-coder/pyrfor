"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfQuarter, endOfWeek, endOfYear, format, isSameDay, parseISO, startOfMonth, startOfQuarter, startOfWeek, startOfYear } from "date-fns";
import useSWR from "swr";
import { BarChart3, CalendarRange, GripVertical, GitBranch, Save, TrendingUp } from "lucide-react";

import { GanttDependencies } from "@/components/gantt/gantt-dependencies";
import { ResourceHistogram } from "@/components/gantt/resource-histogram";
import { GanttTable } from "@/components/gantt/gantt-table";
import type { GanttApiResponse, GanttRow, GanttResourceSeries, GanttScale } from "@/components/gantt/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { clamp, cn, formatCurrency } from "@/lib/utils";

const ganttFetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Gantt data");
  }
  return response.json();
};

const DAY_WIDTH: Record<GanttScale, number> = {
  day: 32,
  week: 20,
  month: 12,
  quarter: 8,
  year: 4,
};

const ROW_HEIGHT = 52;

interface HeaderGroup {
  key: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

interface DragState {
  taskId: string;
  projectId: string;
  mode: "move" | "resize-start" | "resize-end";
  originStart: string;
  originEnd: string;
  originClientX: number;
  deltaDays: number;
}

function toInputDate(value: string) {
  return value.slice(0, 10);
}

function buildHeaderGroups(days: Date[], scale: GanttScale): HeaderGroup[] {
  const groups: HeaderGroup[] = [];

  days.forEach((day, index) => {
    const start =
      scale === "day"
        ? day
        : scale === "week"
          ? startOfWeek(day, { weekStartsOn: 1 })
          : scale === "month"
            ? startOfMonth(day)
            : scale === "quarter"
              ? startOfQuarter(day)
              : startOfYear(day);

    const end =
      scale === "day"
        ? day
        : scale === "week"
          ? endOfWeek(day, { weekStartsOn: 1 })
          : scale === "month"
            ? endOfMonth(day)
            : scale === "quarter"
              ? endOfQuarter(day)
              : endOfYear(day);

    const key =
      scale === "day"
        ? format(day, "yyyy-MM-dd")
        : `${format(start, "yyyy-MM-dd")}:${format(end, "yyyy-MM-dd")}`;

    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.endIndex = index;
      return;
    }

    groups.push({
      key,
      label:
        scale === "day"
          ? format(day, "dd MMM")
          : scale === "week"
            ? `${format(start, "dd MMM")} – ${format(end, "dd MMM")}`
            : scale === "month"
              ? format(day, "MMM yyyy")
              : scale === "quarter"
                ? `Q${Math.floor(day.getMonth() / 3) + 1} ${day.getFullYear()}`
                : format(day, "yyyy"),
      startIndex: index,
      endIndex: index,
    });
  });

  return groups;
}

function getTaskLevel(taskWbs: string | null, parentTaskId: string | null) {
  if (taskWbs) {
    return Math.max(1, taskWbs.split(".").length - 1);
  }
  return parentTaskId ? 2 : 1;
}

function getDurationDays(start: string, end: string) {
  return Math.max(0, differenceInCalendarDays(parseISO(end), parseISO(start)) + 1);
}

function buildRows(data: GanttApiResponse): GanttRow[] {
  const tasksByProject = new Map<string, typeof data.tasks>();
  data.projects.forEach((project) => tasksByProject.set(project.id, []));
  data.tasks.forEach((task) => {
    const bucket = tasksByProject.get(task.projectId) ?? [];
    bucket.push(task);
    tasksByProject.set(task.projectId, bucket);
  });

  const rows: GanttRow[] = [];
  for (const project of data.projects) {
    rows.push({
      id: `project-${project.id}`,
      kind: "project",
      projectId: project.id,
      title: project.name,
      wbs: null,
      level: 0,
      start: project.start,
      end: project.end,
      progress: clamp(project.progress ?? 0),
      durationDays: getDurationDays(project.start, project.end),
      totalFloatDays: 0,
      freeFloatDays: 0,
      isCritical: false,
      isMilestone: false,
      isManualSchedule: false,
      status: project.status,
      parentTaskId: null,
      estimatedCost: null,
      actualCost: null,
      assignments: [],
      baselines: [],
    });

    const projectTasks = [...(tasksByProject.get(project.id) ?? [])].sort((left, right) => {
      const leftWbs = left.wbs ?? `zz-${left.name}`;
      const rightWbs = right.wbs ?? `zz-${right.name}`;
      return leftWbs.localeCompare(rightWbs, "ru");
    });

    projectTasks.forEach((task) => {
      rows.push({
        id: task.id,
        kind: "task",
        projectId: task.projectId,
        title: task.title,
        wbs: task.wbs,
        level: getTaskLevel(task.wbs, task.parentTaskId),
        start: task.start,
        end: task.end,
        progress: clamp(task.progress),
        durationDays: task.durationDays,
        totalFloatDays: task.totalFloatDays,
        freeFloatDays: task.freeFloatDays,
        isCritical: task.isCritical,
        isMilestone: task.isMilestone,
        isManualSchedule: task.isManualSchedule,
        status: task.status,
        parentTaskId: task.parentTaskId,
        estimatedCost: task.estimatedCost,
        actualCost: task.actualCost,
        assignments: task.resourceAssignments,
        baselines: task.baselines,
      });
    });
  }

  return rows;
}

function buildResourceSeries(rows: GanttRow[], days: Date[]): GanttResourceSeries[] {
  const dayMap = new Map(days.map((day, index) => [format(day, "yyyy-MM-dd"), index]));
  const resourceMap = new Map<string, GanttResourceSeries>();

  rows
    .filter((row): row is Extract<GanttRow, { kind: "task" }> => row.kind === "task")
    .forEach((row) => {
      const start = parseISO(row.start);
      const end = parseISO(row.end);

      row.assignments.forEach((assignment) => {
        const key = assignment.memberId
          ? `member:${assignment.memberId}`
          : assignment.equipmentId
            ? `equipment:${assignment.equipmentId}`
            : null;

        if (!key) {
          return;
        }

        const label =
          assignment.memberName ??
          assignment.equipmentName ??
          (assignment.memberId ? assignment.memberId : assignment.equipmentId ?? key);

        if (!resourceMap.has(key)) {
          resourceMap.set(key, {
            key,
            label,
            type: assignment.memberId ? "member" : "equipment",
            points: days.map((day, index) => ({
              offset: index,
              date: format(day, "yyyy-MM-dd"),
              load: 0,
              capacity: 1,
            })),
            maxLoad: 1,
          });
        }

        const series = resourceMap.get(key)!;
        eachDayOfInterval({ start, end }).forEach((day) => {
          const bucketIndex = dayMap.get(format(day, "yyyy-MM-dd"));
          if (bucketIndex === undefined) {
            return;
          }
          const bucket = series.points[bucketIndex];
          bucket.load += Math.max(0, assignment.units) / 100;
          series.maxLoad = Math.max(series.maxLoad, bucket.load);
        });
      });
    });

  return [...resourceMap.values()].sort((left, right) => left.label.localeCompare(right.label, "ru"));
}

async function patchProjectTask(projectId: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/projects/${projectId}/gantt`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Не удалось обновить задачу на диаграмме Ганта.");
  }

  return response.json();
}

async function runProjectAction(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Не удалось выполнить команду планирования.");
  }

  return response.json();
}

export function GanttPage() {
  const { formatDateLocalized } = useLocale();
  const [scale, setScale] = useState<GanttScale>("week");
  const [projectFilter, setProjectFilter] = useState<"all" | string>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null);
  const [showCritical, setShowCritical] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showHistogram, setShowHistogram] = useState(true);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);
  const [inspector, setInspector] = useState<{
    startDate: string;
    endDate: string;
    percentComplete: string;
    isManualSchedule: boolean;
  } | null>(null);

  const endpoint = projectFilter === "all" ? "/api/gantt" : `/api/gantt?projectId=${projectFilter}`;
  const { data, error, isLoading, mutate } = useSWR<GanttApiResponse>(endpoint, ganttFetcher);

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const taskRows = useMemo(
    () => rows.filter((row): row is Extract<GanttRow, { kind: "task" }> => row.kind === "task"),
    [rows]
  );

  useEffect(() => {
    if (!selectedTaskId && taskRows[0]) {
      setSelectedTaskId(taskRows[0].id);
    }
  }, [selectedTaskId, taskRows]);

  const selectedTask = useMemo(
    () => taskRows.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, taskRows]
  );

  useEffect(() => {
    if (!selectedTask) {
      setInspector(null);
      return;
    }

    setInspector({
      startDate: toInputDate(selectedTask.start),
      endDate: toInputDate(selectedTask.end),
      percentComplete: String(selectedTask.progress),
      isManualSchedule: selectedTask.isManualSchedule,
    });
  }, [selectedTask]);

  const timelineStart = useMemo(() => {
    const dates = rows.flatMap((row) => [
      parseISO(row.start),
      parseISO(row.end),
      ...row.baselines.flatMap((baseline) => [parseISO(baseline.startDate), parseISO(baseline.finishDate)]),
    ]);
    const minDate = dates.reduce((min, date) => (date < min ? date : min), dates[0] ?? new Date());
    return addDays(minDate, -2);
  }, [rows]);

  const timelineEnd = useMemo(() => {
    const dates = rows.flatMap((row) => [
      parseISO(row.start),
      parseISO(row.end),
      ...row.baselines.flatMap((baseline) => [parseISO(baseline.startDate), parseISO(baseline.finishDate)]),
    ]);
    const maxDate = dates.reduce((max, date) => (date > max ? date : max), dates[0] ?? new Date());
    return addDays(maxDate, 3);
  }, [rows]);

  const timelineDays = useMemo(
    () => eachDayOfInterval({ start: timelineStart, end: timelineEnd }),
    [timelineEnd, timelineStart]
  );
  const dayWidth = DAY_WIDTH[scale];
  const chartWidth = Math.max(960, timelineDays.length * dayWidth);
  const chartHeight = rows.length * ROW_HEIGHT;
  const headerGroups = useMemo(() => buildHeaderGroups(timelineDays, scale), [scale, timelineDays]);
  const today = new Date();

  const previewByTaskId = useMemo(() => {
    if (!dragState) {
      return new Map<string, { start: string; end: string }>();
    }

    const deltaDays = dragState.deltaDays;
    const originStart = parseISO(dragState.originStart);
    const originEnd = parseISO(dragState.originEnd);
    const durationDays = Math.max(0, differenceInCalendarDays(originEnd, originStart));

    let nextStart = originStart;
    let nextEnd = originEnd;

    if (dragState.mode === "move") {
      nextStart = addDays(originStart, deltaDays);
      nextEnd = addDays(originEnd, deltaDays);
    } else if (dragState.mode === "resize-start") {
      nextStart = addDays(originStart, deltaDays);
      if (differenceInCalendarDays(originEnd, nextStart) < 0) {
        nextStart = originEnd;
      }
    } else {
      nextEnd = addDays(originEnd, deltaDays);
      if (differenceInCalendarDays(nextEnd, originStart) < 0) {
        nextEnd = addDays(originStart, durationDays ? 0 : 0);
      }
    }

    return new Map([[dragState.taskId, { start: nextStart.toISOString(), end: nextEnd.toISOString() }]]);
  }, [dragState]);

  useEffect(() => {
    const activeState = dragState;
    if (!activeState) {
      return undefined;
    }
    const drag = activeState;

    function onPointerMove(event: MouseEvent) {
      const deltaDays = Math.round((event.clientX - drag.originClientX) / dayWidth);
      setDragState((current) => (current ? { ...current, deltaDays } : current));
    }

    async function onPointerUp() {
      const active = drag;
      setDragState(null);
      if (active.deltaDays === 0) {
        return;
      }

      const preview = previewByTaskId.get(active.taskId);
      if (!preview) {
        return;
      }

      try {
        setActionState("Сохраняю перенос задачи...");
        await patchProjectTask(active.projectId, {
          taskId: active.taskId,
          startDate: preview.start,
          endDate: preview.end,
        });
        await mutate();
        setActionState("Пересчёт сохранён.");
      } catch (updateError) {
        setActionState(updateError instanceof Error ? updateError.message : "Не удалось обновить задачу.");
      }
    }

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
    };
  }, [dayWidth, dragState, mutate, previewByTaskId]);

  const rowLayouts = useMemo(() => {
    const layouts = new Map<string, { x: number; width: number; y: number; isMilestone: boolean }>();
    rows.forEach((row, index) => {
      const preview = previewByTaskId.get(row.id);
      const start = parseISO(preview?.start ?? row.start);
      const end = parseISO(preview?.end ?? row.end);
      const x = Math.max(0, differenceInCalendarDays(start, timelineStart) * dayWidth);
      const width = row.isMilestone
        ? 18
        : Math.max(dayWidth, (differenceInCalendarDays(end, start) + 1) * dayWidth - 6);
      layouts.set(row.id, {
        x,
        width,
        y: index * ROW_HEIGHT + 8,
        isMilestone: row.isMilestone,
      });
    });
    return layouts;
  }, [dayWidth, previewByTaskId, rows, timelineStart]);

  const resourceSeries = useMemo(() => buildResourceSeries(taskRows, timelineDays), [taskRows, timelineDays]);

  useEffect(() => {
    if (!selectedResourceKey && resourceSeries[0]) {
      setSelectedResourceKey(resourceSeries[0].key);
    }
  }, [resourceSeries, selectedResourceKey]);

  const selectedResourceSeries = useMemo(
    () => resourceSeries.find((series) => series.key === selectedResourceKey) ?? resourceSeries[0] ?? null,
    [resourceSeries, selectedResourceKey]
  );

  async function refreshAfterAction(action: Promise<unknown>, successMessage: string) {
    try {
      setActionState("Выполняю команду...");
      await action;
      await mutate();
      setActionState(successMessage);
    } catch (actionError) {
      setActionState(actionError instanceof Error ? actionError.message : "Команда не выполнена.");
    }
  }

  async function handleShiftTask(row: Extract<GanttRow, { kind: "task" }>, deltaDays: number) {
    await refreshAfterAction(
      patchProjectTask(row.projectId, {
        taskId: row.id,
        startDate: addDays(parseISO(row.start), deltaDays).toISOString(),
        endDate: addDays(parseISO(row.end), deltaDays).toISOString(),
      }),
      "Задача сдвинута и зависимости пересчитаны."
    );
  }

  async function handleAdjustProgress(row: Extract<GanttRow, { kind: "task" }>, deltaPercent: number) {
    await refreshAfterAction(
      patchProjectTask(row.projectId, {
        taskId: row.id,
        percentComplete: clamp(row.progress + deltaPercent),
      }),
      "Процент выполнения обновлён."
    );
  }

  async function handleInspectorSave() {
    if (!selectedTask || !inspector) {
      return;
    }

    await refreshAfterAction(
      patchProjectTask(selectedTask.projectId, {
        taskId: selectedTask.id,
        startDate: `${inspector.startDate}T00:00:00.000Z`,
        endDate: `${inspector.endDate}T00:00:00.000Z`,
        percentComplete: clamp(Number(inspector.percentComplete || 0)),
        isManualSchedule: inspector.isManualSchedule,
      }),
      "Параметры задачи сохранены."
    );
  }

  const canRunProjectActions = projectFilter !== "all";

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5 text-[var(--brand)]" />
              Диаграмма Ганта
            </CardTitle>
            <p className="text-sm text-[var(--ink-muted)]">
              Critical path, baseline, drag-to-move/resize, ресурсная загрузка и live auto-scheduling.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className={`${fieldStyles} h-9 w-[220px] px-3 py-2 text-sm`}
              onChange={(event) => setProjectFilter(event.target.value as "all" | string)}
              value={projectFilter}
            >
              <option value="all">Все проекты</option>
              {(data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              className={`${fieldStyles} h-9 w-[120px] px-3 py-2 text-sm`}
              onChange={(event) => setScale(event.target.value as GanttScale)}
              value={scale}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
            <Button onClick={() => setShowCritical((value) => !value)} size="sm" variant={showCritical ? "default" : "outline"}>
              <TrendingUp className="h-4 w-4" />
              Critical
            </Button>
            <Button onClick={() => setShowBaseline((value) => !value)} size="sm" variant={showBaseline ? "default" : "outline"}>
              <Save className="h-4 w-4" />
              Baseline
            </Button>
            <Button onClick={() => setShowDependencies((value) => !value)} size="sm" variant={showDependencies ? "default" : "outline"}>
              <GitBranch className="h-4 w-4" />
              Links
            </Button>
            <Button onClick={() => setShowHistogram((value) => !value)} size="sm" variant={showHistogram ? "default" : "outline"}>
              <BarChart3 className="h-4 w-4" />
              Histogram
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          {isLoading ? (
            <CardContent className="py-8 text-center text-sm text-[var(--ink-muted)]">
              Загружаю диаграмму Ганта...
            </CardContent>
          ) : error ? (
            <CardContent className="py-8 text-center text-sm text-[var(--ink-muted)]">
              Не удалось загрузить данные для Ганта.
            </CardContent>
          ) : !rows.length ? (
            <CardContent className="py-8 text-center text-sm text-[var(--ink-muted)]">
              В проектах пока нет задач для таймлайна.
            </CardContent>
          ) : (
            <CardContent className="space-y-3 p-0">
              <div className="border-b border-[var(--line)] px-3 py-3 text-sm text-[var(--ink-muted)]">
                {actionState ?? "Drag bars to move, use handles to resize, сохранение идёт через live PATCH API."}
              </div>
              <div className="overflow-auto">
                <div className="flex min-w-[1280px]">
                  <GanttTable
                    formatDateLocalized={formatDateLocalized}
                    onAdjustProgress={handleAdjustProgress}
                    onSelectTask={setSelectedTaskId}
                    onShiftTask={handleShiftTask}
                    rows={rows}
                    selectedTaskId={selectedTaskId}
                  />

                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <div style={{ width: chartWidth }}>
                      <div className="relative border-b border-[var(--line)] bg-[var(--panel-soft)]">
                        <div className="relative h-14">
                          {headerGroups.map((group) => (
                            <div
                              key={group.key}
                              className="absolute inset-y-0 border-r border-[var(--line)] px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]"
                              style={{
                                left: group.startIndex * dayWidth,
                                width: (group.endIndex - group.startIndex + 1) * dayWidth,
                              }}
                            >
                              {group.label}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="relative" style={{ height: chartHeight }}>
                        {timelineDays.map((day, index) => (
                          <Fragment key={day.toISOString()}>
                            <div
                              className={cn(
                                "absolute inset-y-0 border-r",
                                index % 7 === 0 ? "border-[var(--line-strong)]" : "border-[var(--line)]/70"
                              )}
                              style={{ left: index * dayWidth }}
                            />
                            {isSameDay(day, today) ? (
                              <div
                                className="absolute inset-y-0 z-[4] w-[2px] bg-rose-500"
                                style={{ left: index * dayWidth + Math.floor(dayWidth / 2) }}
                              />
                            ) : null}
                          </Fragment>
                        ))}

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
                                    onMouseDown={(event) => {
                                      if (row.kind !== "task") return;
                                      event.preventDefault();
                                      setDragState({
                                        taskId: row.id,
                                        projectId: row.projectId,
                                        mode: "move",
                                        originStart: row.start,
                                        originEnd: row.end,
                                        originClientX: event.clientX,
                                        deltaDays: 0,
                                      });
                                    }}
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
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            setDragState({
                                              taskId: row.id,
                                              projectId: row.projectId,
                                              mode: "resize-start",
                                              originStart: row.start,
                                              originEnd: row.end,
                                              originClientX: event.clientX,
                                              deltaDays: 0,
                                            });
                                          }}
                                          type="button"
                                        />
                                        <button
                                          aria-label="Move task"
                                          className="absolute inset-0 flex items-center justify-center gap-1 rounded-[10px] px-2 text-[11px] font-semibold text-white"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            setDragState({
                                              taskId: row.id,
                                              projectId: row.projectId,
                                              mode: "move",
                                              originStart: row.start,
                                              originEnd: row.end,
                                              originClientX: event.clientX,
                                              deltaDays: 0,
                                            });
                                          }}
                                          onDoubleClick={() => setSelectedTaskId(row.id)}
                                          type="button"
                                        >
                                          <GripVertical className="h-3 w-3 opacity-70" />
                                          <span className="truncate">{row.progress}%</span>
                                        </button>
                                        <button
                                          aria-label="Resize end"
                                          className="absolute inset-y-0 right-0 hidden w-2 cursor-ew-resize rounded-r-[10px] bg-white/20 group-hover:block"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            setDragState({
                                              taskId: row.id,
                                              projectId: row.projectId,
                                              mode: "resize-end",
                                              originStart: row.start,
                                              originEnd: row.end,
                                              originClientX: event.clientX,
                                              deltaDays: 0,
                                            });
                                          }}
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

                        <GanttDependencies
                          chartHeight={chartHeight}
                          dependencies={data?.dependencies ?? []}
                          hidden={!showDependencies}
                          rowHeight={ROW_HEIGHT}
                          rowLayouts={rowLayouts}
                          rows={rows}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {showHistogram ? (
                <div className="space-y-3 border-t border-[var(--line)] px-3 pb-3 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[var(--ink)]">Resource histogram</div>
                    <select
                      className={`${fieldStyles} h-9 max-w-[280px] px-3 py-2 text-sm`}
                      onChange={(event) => setSelectedResourceKey(event.target.value)}
                      value={selectedResourceSeries?.key ?? ""}
                    >
                      {resourceSeries.map((series) => (
                        <option key={series.key} value={series.key}>
                          {series.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ResourceHistogram dayWidth={Math.max(6, dayWidth)} series={selectedResourceSeries} width={chartWidth} />
                </div>
              ) : null}
            </CardContent>
          )}
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task inspector</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedTask || !inspector ? (
                <div className="text-sm text-[var(--ink-muted)]">Выбери задачу слева или на таймлайне.</div>
              ) : (
                <>
                  <div>
                    <div className="text-sm font-semibold text-[var(--ink)]">{selectedTask.title}</div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {selectedTask.wbs ?? "—"} · Float {selectedTask.totalFloatDays}д · {selectedTask.isCritical ? "Critical" : "Non-critical"}
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
                      Start
                      <Input
                        onChange={(event) =>
                          setInspector((current) => (current ? { ...current, startDate: event.target.value } : current))
                        }
                        type="date"
                        value={inspector.startDate}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
                      Finish
                      <Input
                        onChange={(event) =>
                          setInspector((current) => (current ? { ...current, endDate: event.target.value } : current))
                        }
                        type="date"
                        value={inspector.endDate}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
                      Percent complete
                      <Input
                        max={100}
                        min={0}
                        onChange={(event) =>
                          setInspector((current) => (current ? { ...current, percentComplete: event.target.value } : current))
                        }
                        type="number"
                        value={inspector.percentComplete}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input
                        checked={inspector.isManualSchedule}
                        onChange={(event) =>
                          setInspector((current) =>
                            current ? { ...current, isManualSchedule: event.target.checked } : current
                          )
                        }
                        type="checkbox"
                      />
                      Manual schedule
                    </label>
                    <Button onClick={handleInspectorSave}>Сохранить задачу</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Planning actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                disabled={!canRunProjectActions}
                onClick={() =>
                  canRunProjectActions &&
                  refreshAfterAction(
                    runProjectAction("/api/scheduling/auto-schedule", { projectId: projectFilter }),
                    "Auto-schedule выполнен."
                  )
                }
                variant="outline"
              >
                Auto-schedule project
              </Button>
              <Button
                disabled={!canRunProjectActions}
                onClick={() =>
                  canRunProjectActions &&
                  refreshAfterAction(
                    runProjectAction("/api/scheduling/resource-leveling", {
                      projectId: projectFilter,
                      apply: true,
                    }),
                    "Resource leveling выполнен."
                  )
                }
                variant="outline"
              >
                Level resources
              </Button>
              <Button
                disabled={!canRunProjectActions}
                onClick={() =>
                  canRunProjectActions &&
                  refreshAfterAction(
                    runProjectAction("/api/scheduling/baseline", { projectId: projectFilter }),
                    "Baseline сохранён."
                  )
                }
                variant="outline"
              >
                Save baseline
              </Button>
              {!canRunProjectActions ? (
                <div className="text-xs text-[var(--ink-muted)]">
                  Для команд планирования выбери конкретный проект.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Rows</span>
                <span className="font-semibold text-[var(--ink)]">{rows.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Critical tasks</span>
                <span className="font-semibold text-rose-600">
                  {taskRows.filter((task) => task.isCritical).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Baseline tasks</span>
                <span className="font-semibold text-[var(--ink)]">
                  {taskRows.filter((task) => task.baselines.length > 0).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Assignments</span>
                <span className="font-semibold text-[var(--ink)]">
                  {taskRows.reduce((sum, task) => sum + task.assignments.length, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Actual cost</span>
                <span className="font-semibold text-[var(--ink)]">
                  {formatCurrency(
                    taskRows.reduce((sum, task) => sum + (task.assignments.reduce((taskSum, assignment) => taskSum + ((assignment.costRate ?? 0) * (assignment.actualHours ?? assignment.plannedHours ?? 0)), 0) || task.actualCost || 0), 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
