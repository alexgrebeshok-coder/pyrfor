"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, eachDayOfInterval, parseISO } from "date-fns";
import useSWR from "swr";

import { GanttPageView } from "@/components/gantt/gantt-page-view";
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  buildHeaderGroups,
  buildResourceSeries,
  buildRows,
  ganttFetcher,
  patchProjectTask,
  runProjectAction,
  toInputDate,
} from "@/components/gantt/gantt-helpers";
import type { DragState, InspectorState } from "@/components/gantt/gantt-helpers";
import type { GanttApiResponse, GanttRowTask, GanttScale } from "@/components/gantt/types";
import { clamp } from "@/lib/utils";

interface RowLayout {
  x: number;
  width: number;
  y: number;
  isMilestone: boolean;
}

export function GanttPage() {
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

  const endpoint = projectFilter === "all" ? "/api/gantt" : "/api/gantt?projectId=" + projectFilter;
  const { data, error, isLoading, mutate } = useSWR<GanttApiResponse>(endpoint, ganttFetcher);

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const taskRows = useMemo(
    () => rows.filter((row): row is GanttRowTask => row.kind === "task"),
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
    const layouts = new Map<string, RowLayout>();
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

  async function handleShiftTask(row: GanttRowTask, deltaDays: number) {
    await refreshAfterAction(
      patchProjectTask(row.projectId, {
        taskId: row.id,
        startDate: addDays(parseISO(row.start), deltaDays).toISOString(),
        endDate: addDays(parseISO(row.end), deltaDays).toISOString(),
      }),
      "Задача сдвинута и зависимости пересчитаны."
    );
  }

  async function handleAdjustProgress(row: GanttRowTask, deltaPercent: number) {
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
        startDate: inspector.startDate + "T00:00:00.000Z",
        endDate: inspector.endDate + "T00:00:00.000Z",
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
    <GanttPageView
      actionState={actionState}
      canRunProjectActions={canRunProjectActions}
      chartHeight={chartHeight}
      chartWidth={chartWidth}
      data={data}
      dayWidth={dayWidth}
      error={error}
      headerGroups={headerGroups}
      inspector={inspector}
      isLoading={isLoading}
      onAdjustProgress={handleAdjustProgress}
      onAutoSchedule={handleAutoSchedule}
      onDragStart={setDragState}
      onInspectorChange={setInspector}
      onInspectorSave={handleInspectorSave}
      onLevelResources={handleLevelResources}
      onProjectFilterChange={setProjectFilter}
      onResourceKeyChange={(key) => setSelectedResourceKey(key)}
      onSaveBaseline={handleSaveBaseline}
      onScaleChange={setScale}
      onSelectTask={(taskId) => setSelectedTaskId(taskId)}
      onShiftTask={handleShiftTask}
      onToggleShowBaseline={() => setShowBaseline((value) => !value)}
      onToggleShowCritical={() => setShowCritical((value) => !value)}
      onToggleShowDependencies={() => setShowDependencies((value) => !value)}
      onToggleShowHistogram={() => setShowHistogram((value) => !value)}
      previewByTaskId={previewByTaskId}
      projectFilter={projectFilter}
      resourceSeries={resourceSeries}
      rowLayouts={rowLayouts}
      rows={rows}
      scale={scale}
      selectedResourceSeries={selectedResourceSeries}
      selectedTask={selectedTask}
      selectedTaskId={selectedTaskId}
      showBaseline={showBaseline}
      showCritical={showCritical}
      showDependencies={showDependencies}
      showHistogram={showHistogram}
      taskRows={taskRows}
      timelineDays={timelineDays}
      timelineStart={timelineStart}
    />
  );
}
