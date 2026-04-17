"use client";

import { Fragment, type Dispatch, type SetStateAction } from "react";
import { isSameDay } from "date-fns";
import { BarChart3, CalendarRange, GitBranch, Save, TrendingUp } from "lucide-react";

import { GanttChartBars } from "@/components/gantt/gantt-chart-bars";
import { GanttDependencies } from "@/components/gantt/gantt-dependencies";
import type { DragState, HeaderGroup, InspectorState } from "@/components/gantt/gantt-helpers";
import { GanttResourcePanel } from "@/components/gantt/gantt-resource-panel";
import { GanttTable } from "@/components/gantt/gantt-table";
import { GanttTaskPanel } from "@/components/gantt/gantt-task-panel";
import type { GanttApiResponse, GanttResourceSeries, GanttRow, GanttRowTask, GanttScale } from "@/components/gantt/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { cn } from "@/lib/utils";

interface RowLayout {
  x: number;
  width: number;
  y: number;
  isMilestone: boolean;
}

interface GanttPageViewProps {
  actionState: string | null;
  canRunProjectActions: boolean;
  chartHeight: number;
  chartWidth: number;
  data?: GanttApiResponse;
  dayWidth: number;
  error: unknown;
  headerGroups: HeaderGroup[];
  inspector: InspectorState | null;
  isLoading: boolean;
  onAdjustProgress: (row: GanttRowTask, deltaPercent: number) => Promise<void>;
  onAutoSchedule: () => Promise<void>;
  onDragStart: (state: DragState) => void;
  onInspectorChange: Dispatch<SetStateAction<InspectorState | null>>;
  onInspectorSave: () => Promise<void>;
  onLevelResources: () => Promise<void>;
  onProjectFilterChange: (projectId: "all" | string) => void;
  onResourceKeyChange: (key: string) => void;
  onSaveBaseline: () => Promise<void>;
  onScaleChange: (scale: GanttScale) => void;
  onSelectTask: (taskId: string) => void;
  onShiftTask: (row: GanttRowTask, deltaDays: number) => Promise<void>;
  onToggleShowBaseline: () => void;
  onToggleShowCritical: () => void;
  onToggleShowDependencies: () => void;
  onToggleShowHistogram: () => void;
  previewByTaskId: Map<string, { start: string; end: string }>;
  projectFilter: "all" | string;
  resourceSeries: GanttResourceSeries[];
  rowLayouts: Map<string, RowLayout>;
  rows: GanttRow[];
  scale: GanttScale;
  selectedResourceSeries: GanttResourceSeries | null;
  selectedTask: GanttRowTask | null;
  selectedTaskId: string | null;
  showBaseline: boolean;
  showCritical: boolean;
  showDependencies: boolean;
  showHistogram: boolean;
  taskRows: GanttRowTask[];
  timelineDays: Date[];
  timelineStart: Date;
}

export function GanttPageView({
  actionState,
  canRunProjectActions,
  chartHeight,
  chartWidth,
  data,
  dayWidth,
  error,
  headerGroups,
  inspector,
  isLoading,
  onAdjustProgress,
  onAutoSchedule,
  onDragStart,
  onInspectorChange,
  onInspectorSave,
  onLevelResources,
  onProjectFilterChange,
  onResourceKeyChange,
  onSaveBaseline,
  onScaleChange,
  onSelectTask,
  onShiftTask,
  onToggleShowBaseline,
  onToggleShowCritical,
  onToggleShowDependencies,
  onToggleShowHistogram,
  previewByTaskId,
  projectFilter,
  resourceSeries,
  rowLayouts,
  rows,
  scale,
  selectedResourceSeries,
  selectedTask,
  selectedTaskId,
  showBaseline,
  showCritical,
  showDependencies,
  showHistogram,
  taskRows,
  timelineDays,
  timelineStart,
}: GanttPageViewProps) {
  const { formatDateLocalized } = useLocale();
  const today = new Date();

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
              className={fieldStyles + " h-9 w-[220px] px-3 py-2 text-sm"}
              onChange={(event) => onProjectFilterChange(event.target.value as "all" | string)}
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
              className={fieldStyles + " h-9 w-[120px] px-3 py-2 text-sm"}
              onChange={(event) => onScaleChange(event.target.value as GanttScale)}
              value={scale}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
            <Button onClick={onToggleShowCritical} size="sm" variant={showCritical ? "default" : "outline"}>
              <TrendingUp className="h-4 w-4" />
              Critical
            </Button>
            <Button onClick={onToggleShowBaseline} size="sm" variant={showBaseline ? "default" : "outline"}>
              <Save className="h-4 w-4" />
              Baseline
            </Button>
            <Button onClick={onToggleShowDependencies} size="sm" variant={showDependencies ? "default" : "outline"}>
              <GitBranch className="h-4 w-4" />
              Links
            </Button>
            <Button onClick={onToggleShowHistogram} size="sm" variant={showHistogram ? "default" : "outline"}>
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
                    onAdjustProgress={onAdjustProgress}
                    onSelectTask={onSelectTask}
                    onShiftTask={onShiftTask}
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
                          onDragStart={onDragStart}
                          onSelectTask={onSelectTask}
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
                          rowHeight={52}
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
                  onResourceKeyChange={onResourceKeyChange}
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
          onAutoSchedule={onAutoSchedule}
          onInspectorChange={onInspectorChange}
          onInspectorSave={onInspectorSave}
          onLevelResources={onLevelResources}
          onSaveBaseline={onSaveBaseline}
          rows={rows}
          selectedTask={selectedTask}
          taskRows={taskRows}
        />
      </div>
    </div>
  );
}
