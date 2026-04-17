"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import useSWR from "swr";
import { BarChart3, CalendarRange, GitBranch, Save, TrendingUp } from "lucide-react";

import { GanttChartBars } from "@/components/gantt/gantt-chart-bars";
import { GanttDependencies } from "@/components/gantt/gantt-dependencies";
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  buildHeaderGroups,
  buildRows,
  buildResourceSeries,
  ganttFetcher,
  patchProjectTask,
  runProjectAction,
  toInputDate,
} from "@/components/gantt/gantt-helpers";
import type { DragState, InspectorState } from "@/components/gantt/gantt-helpers";
import { GanttResourcePanel } from "@/components/gantt/gantt-resource-panel";
import { GanttTable } from "@/components/gantt/gantt-table";
import { GanttTaskPanel } from "@/components/gantt/gantt-task-panel";
import type { GanttApiResponse, GanttRow, GanttScale } from "@/components/gantt/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { clamp, cn } from "@/lib/utils";

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
  const [inspector, setInspector] = useState<InspectorState | null>(null);

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

  const handleAutoSchedule = () =>
    refreshAfterAction(
      runProjectAction("/api/scheduling/auto-schedule", { projectId: projectFilter }),
      "Auto-schedule выполнен."
    );

  const handleLevelResources = () =>
    refreshAfterAction(
      runProjectAction("/api/scheduling/resource-leveling", { projectId: projectFilter, apply: true }),
      "Resource leveling выполнен."
    );

  const handleSaveBaseline = () =>
    refreshAfterAction(
      runProjectAction("/api/scheduling/baseline", { projectId: projectFilter }),
      "Baseline сохранён."
    );

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

                        <GanttChartBars
                          dayWidth={dayWidth}
                          onDragStart={(state) => setDragState(state)}
                          onSelectTask={setSelectedTaskId}
                          previewByTaskId={previewByTaskId}
                          rows={rows}
                          showBaseline={showBaseline}
                          showCritical={showCritical}
                          timelineStart={timelineStart}
                        />

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
                <GanttResourcePanel
                  chartWidth={chartWidth}
                  dayWidth={dayWidth}
                  onResourceKeyChange={setSelectedResourceKey}
                  resourceSeries={resourceSeries}
                  selectedResourceSeries={selectedResourceSeries}
                />
              ) : null}
            </CardContent>
          )}
        </Card>

        <GanttTaskPanel
          canRunProjectActions={canRunProjectActions}
          inspector={inspector}
          onAutoSchedule={handleAutoSchedule}
          onInspectorChange={setInspector}
          onInspectorSave={handleInspectorSave}
          onLevelResources={handleLevelResources}
          onSaveBaseline={handleSaveBaseline}
          rows={rows}
          selectedTask={selectedTask}
          taskRows={taskRows}
        />
      </div>
    </div>
  );
}
