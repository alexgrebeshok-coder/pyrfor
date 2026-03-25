import { prisma } from "@/lib/prisma";
import { calculateCriticalPath } from "@/lib/scheduling/critical-path";

export interface GanttProjectV2 {
  id: string;
  name: string;
  start: string;
  end: string;
  status: string;
  progress: number | null;
}

export interface GanttDependencyV2 {
  id: string;
  source: string;
  target: string;
  type: string;
  lagDays: number;
  isCritical: boolean;
  sourceTask: string;
  targetTask: string;
}

export interface GanttTaskV2 {
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

export interface ProjectGanttSnapshot {
  project: GanttProjectV2;
  tasks: GanttTaskV2[];
  dependencies: GanttDependencyV2[];
}

export async function buildProjectGanttSnapshot(
  projectId: string
): Promise<ProjectGanttSnapshot | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      start: true,
      end: true,
      status: true,
      progress: true,
    },
  });

  if (!project) {
    return null;
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      status: true,
      projectId: true,
      startDate: true,
      dueDate: true,
      estimatedHours: true,
      estimatedCost: true,
      actualCost: true,
      percentComplete: true,
      wbs: true,
      parentTaskId: true,
      isMilestone: true,
      isManualSchedule: true,
      constraintType: true,
      constraintDate: true,
      dependencies: {
        select: {
          id: true,
          dependsOnTaskId: true,
          type: true,
          lagDays: true,
          dependsOnTask: {
            select: {
              title: true,
            },
          },
        },
      },
      baselines: {
        orderBy: [{ baselineNumber: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          baselineNumber: true,
          startDate: true,
          finishDate: true,
          duration: true,
          cost: true,
          work: true,
        },
      },
      resourceAssignments: {
        select: {
          id: true,
          memberId: true,
          member: {
            select: {
              name: true,
            },
          },
          equipmentId: true,
          equipment: {
            select: {
              name: true,
            },
          },
          units: true,
          plannedHours: true,
          actualHours: true,
          costRate: true,
        },
      },
    },
    orderBy: [{ wbs: "asc" }, { startDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
  });

  const criticalPath = calculateCriticalPath({
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      estimatedHours: task.estimatedHours,
      percentComplete: task.percentComplete,
      isMilestone: task.isMilestone,
      isManualSchedule: task.isManualSchedule,
      constraintType: task.constraintType,
      constraintDate: task.constraintDate,
    })),
    dependencies: tasks.flatMap((task) =>
      task.dependencies.map((dependency) => ({
        id: dependency.id,
        taskId: task.id,
        dependsOnTaskId: dependency.dependsOnTaskId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      }))
    ),
    projectStart: project.start,
    projectEnd: project.end,
  });

  const metricsByTaskId = new Map(criticalPath.tasks.map((task) => [task.taskId, task]));

  return {
    project: {
      id: project.id,
      name: project.name,
      start: project.start.toISOString(),
      end: project.end.toISOString(),
      status: project.status,
      progress: project.progress,
    },
    tasks: tasks.map((task) => {
      const metrics = metricsByTaskId.get(task.id);
      const progress =
        typeof task.percentComplete === "number"
          ? task.percentComplete
          : task.status === "done"
            ? 100
            : task.status === "in_progress"
              ? 50
              : 0;

      return {
        id: task.id,
        name: task.title,
        title: task.title,
        start: (metrics?.earliestStart ?? task.startDate ?? task.dueDate).toISOString(),
        end: (metrics?.earliestFinish ?? task.dueDate).toISOString(),
        progress,
        status: task.status,
        projectId: task.projectId,
        type: task.status,
        dependencies: task.dependencies.map((dependency) => dependency.dependsOnTaskId),
        wbs: task.wbs,
        parentTaskId: task.parentTaskId,
        isMilestone: task.isMilestone,
        isManualSchedule: task.isManualSchedule,
        durationDays: metrics?.durationDays ?? 0,
        totalFloatDays: metrics?.totalFloatDays ?? 0,
        freeFloatDays: metrics?.freeFloatDays ?? 0,
        isCritical: metrics?.isCritical ?? false,
        estimatedHours: task.estimatedHours,
        estimatedCost: task.estimatedCost,
        actualCost: task.actualCost,
        resourceAssignments: task.resourceAssignments.map((assignment) => ({
          id: assignment.id,
          memberId: assignment.memberId,
          memberName: assignment.member?.name ?? null,
          equipmentId: assignment.equipmentId,
          equipmentName: assignment.equipment?.name ?? null,
          units: assignment.units,
          plannedHours: assignment.plannedHours,
          actualHours: assignment.actualHours,
          costRate: assignment.costRate,
        })),
        baselines: task.baselines.map((baseline) => ({
          id: baseline.id,
          baselineNumber: baseline.baselineNumber,
          startDate: baseline.startDate.toISOString(),
          finishDate: baseline.finishDate.toISOString(),
          duration: baseline.duration,
          cost: baseline.cost,
          work: baseline.work,
        })),
      };
    }),
    dependencies: tasks.flatMap((task) =>
      task.dependencies.map((dependency) => ({
        id: dependency.id,
        source: dependency.dependsOnTaskId,
        target: task.id,
        type: dependency.type,
        lagDays: dependency.lagDays,
        isCritical:
          Boolean(metricsByTaskId.get(task.id)?.isCritical) &&
          Boolean(metricsByTaskId.get(dependency.dependsOnTaskId)?.isCritical),
        sourceTask: dependency.dependsOnTask.title,
        targetTask: task.title,
      }))
    ),
  };
}
