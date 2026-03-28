export type GanttScale = "day" | "week" | "month" | "quarter" | "year";

export interface GanttApiProject {
  id: string;
  name: string;
  start: string;
  end: string;
  status: string;
  progress: number | null;
}

export interface GanttApiTask {
  id: string;
  name: string;
  title: string;
  start: string;
  end: string;
  progress: number;
  status: string;
  projectId: string;
  type: string;
  dependencies: string[];
  wbs: string | null;
  parentTaskId: string | null;
  isMilestone: boolean;
  isManualSchedule: boolean;
  durationDays: number;
  totalFloatDays: number;
  freeFloatDays: number;
  isCritical: boolean;
  estimatedHours: number | null;
  estimatedCost: number | null;
  actualCost: number | null;
  resourceAssignments: Array<{
    id: string;
    memberId: string | null;
    memberName: string | null;
    equipmentId: string | null;
    equipmentName: string | null;
    units: number;
    plannedHours: number | null;
    actualHours: number | null;
    costRate: number | null;
  }>;
  baselines: Array<{
    id: string;
    baselineNumber: number;
    startDate: string;
    finishDate: string;
    duration: number | null;
    cost: number | null;
    work: number | null;
  }>;
}

export interface GanttApiDependency {
  id: string;
  source: string;
  target: string;
  type: string;
  lagDays: number;
  isCritical: boolean;
  sourceTask: string;
  targetTask: string;
}

export interface GanttApiResponse {
  projects: GanttApiProject[];
  tasks: GanttApiTask[];
  dependencies: GanttApiDependency[];
}

export interface GanttRowProject {
  id: string;
  kind: "project";
  projectId: string;
  title: string;
  wbs: string | null;
  level: number;
  start: string;
  end: string;
  progress: number;
  durationDays: number;
  totalFloatDays: number;
  freeFloatDays: number;
  isCritical: boolean;
  isMilestone: boolean;
  isManualSchedule: boolean;
  status: string;
  parentTaskId: null;
  estimatedCost: number | null;
  actualCost: number | null;
  assignments: GanttApiTask["resourceAssignments"];
  baselines: GanttApiTask["baselines"];
}

export interface GanttRowTask {
  id: string;
  kind: "task";
  projectId: string;
  title: string;
  wbs: string | null;
  level: number;
  start: string;
  end: string;
  progress: number;
  durationDays: number;
  totalFloatDays: number;
  freeFloatDays: number;
  isCritical: boolean;
  isMilestone: boolean;
  isManualSchedule: boolean;
  status: string;
  parentTaskId: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  assignments: GanttApiTask["resourceAssignments"];
  baselines: GanttApiTask["baselines"];
}

export type GanttRow = GanttRowProject | GanttRowTask;

export interface GanttResourceLoadPoint {
  offset: number;
  date: string;
  load: number;
  capacity: number;
}

export interface GanttResourceSeries {
  key: string;
  label: string;
  type: "member" | "equipment";
  points: GanttResourceLoadPoint[];
  maxLoad: number;
}
