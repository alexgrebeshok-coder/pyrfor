"use client";

import type { Dispatch, SetStateAction } from "react";

import type { GanttRow, GanttRowTask } from "@/components/gantt/types";
import type { InspectorState } from "@/components/gantt/gantt-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { formatCurrency } from "@/lib/utils";

interface GanttTaskPanelProps {
  selectedTask: GanttRowTask | null;
  inspector: InspectorState | null;
  onInspectorChange: Dispatch<SetStateAction<InspectorState | null>>;
  onInspectorSave: () => void;
  canRunProjectActions: boolean;
  onAutoSchedule: () => void;
  onLevelResources: () => void;
  onSaveBaseline: () => void;
  taskRows: GanttRowTask[];
  rows: GanttRow[];
}

export function GanttTaskPanel({
  selectedTask,
  inspector,
  onInspectorChange,
  onInspectorSave,
  canRunProjectActions,
  onAutoSchedule,
  onLevelResources,
  onSaveBaseline,
  taskRows,
  rows,
}: GanttTaskPanelProps) {
  return (
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
                  {selectedTask.wbs ?? "—"} · Float {selectedTask.totalFloatDays}д ·{" "}
                  {selectedTask.isCritical ? "Critical" : "Non-critical"}
                </div>
              </div>
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
                  Start
                  <Input
                    onChange={(event) =>
                      onInspectorChange((current) =>
                        current ? { ...current, startDate: event.target.value } : current
                      )
                    }
                    type="date"
                    value={inspector.startDate}
                  />
                </label>
                <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
                  Finish
                  <Input
                    onChange={(event) =>
                      onInspectorChange((current) =>
                        current ? { ...current, endDate: event.target.value } : current
                      )
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
                      onInspectorChange((current) =>
                        current ? { ...current, percentComplete: event.target.value } : current
                      )
                    }
                    type="number"
                    value={inspector.percentComplete}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    checked={inspector.isManualSchedule}
                    onChange={(event) =>
                      onInspectorChange((current) =>
                        current ? { ...current, isManualSchedule: event.target.checked } : current
                      )
                    }
                    type="checkbox"
                  />
                  Manual schedule
                </label>
                <Button onClick={onInspectorSave}>Сохранить задачу</Button>
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
          <Button disabled={!canRunProjectActions} onClick={onAutoSchedule} variant="outline">
            Auto-schedule project
          </Button>
          <Button disabled={!canRunProjectActions} onClick={onLevelResources} variant="outline">
            Level resources
          </Button>
          <Button disabled={!canRunProjectActions} onClick={onSaveBaseline} variant="outline">
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
                taskRows.reduce(
                  (sum, task) =>
                    sum +
                    (task.assignments.reduce(
                      (taskSum, assignment) =>
                        taskSum +
                        (assignment.costRate ?? 0) *
                          (assignment.actualHours ?? assignment.plannedHours ?? 0),
                      0
                    ) ||
                      task.actualCost ||
                      0),
                  0
                )
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
