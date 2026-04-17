import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";

import type { GanttApiResponse, GanttRow, GanttResourceSeries, GanttScale } from "@/components/gantt/types";
import { clamp } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────

export const DAY_WIDTH: Record<GanttScale, number> = {
  day: 32,
  week: 20,
  month: 12,
  quarter: 8,
  year: 4,
};

export const ROW_HEIGHT = 52;

// ── Types ──────────────────────────────────────────────────

export interface HeaderGroup {
  key: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

export interface DragState {
  taskId: string;
  projectId: string;
  mode: "move" | "resize-start" | "resize-end";
  originStart: string;
  originEnd: string;
  originClientX: number;
  deltaDays: number;
}

export interface InspectorState {
  startDate: string;
  endDate: string;
  percentComplete: string;
  isManualSchedule: boolean;
}

// ── Helpers ────────────────────────────────────────────────

export function toInputDate(value: string) {
  return value.slice(0, 10);
}

export function getTaskLevel(taskWbs: string | null, parentTaskId: string | null) {
  if (taskWbs) {
    return Math.max(1, taskWbs.split(".").length - 1);
  }
  return parentTaskId ? 2 : 1;
}

export function getDurationDays(start: string, end: string) {
  return Math.max(0, differenceInCalendarDays(parseISO(end), parseISO(start)) + 1);
}

export function buildHeaderGroups(days: Date[], scale: GanttScale): HeaderGroup[] {
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

export function buildRows(data: GanttApiResponse): GanttRow[] {
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

export function buildResourceSeries(rows: GanttRow[], days: Date[]): GanttResourceSeries[] {
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

// ── API helpers ────────────────────────────────────────────

export async function ganttFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Gantt data");
  }
  return response.json();
}

export async function patchProjectTask(projectId: string, payload: Record<string, unknown>) {
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

export async function runProjectAction(path: string, payload: Record<string, unknown>) {
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
