import { prisma } from "@/lib/prisma";
import type {
  CriticalPathResult,
  SchedulingDependencyInput,
  SchedulingTaskInput,
} from "@/lib/scheduling/critical-path";
import type {
  ResourceCapacityInput,
  SchedulingResourceAssignment,
} from "@/lib/scheduling/resource-leveling";

export interface ProjectSchedulingContext {
  project: {
    id: string;
    start: Date;
    end: Date;
  };
  tasks: SchedulingTaskInput[];
  dependencies: SchedulingDependencyInput[];
  assignments: SchedulingResourceAssignment[];
  capacities: ResourceCapacityInput[];
}

export function createSchedulingId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function getProjectSchedulingContext(
  projectId: string
): Promise<ProjectSchedulingContext | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      start: true,
      end: true,
    },
  });

  if (!project) {
    return null;
  }

  const [tasks, assignments] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        projectId: true,
        startDate: true,
        dueDate: true,
        estimatedHours: true,
        percentComplete: true,
        isMilestone: true,
        isManualSchedule: true,
        constraintType: true,
        constraintDate: true,
        dependencies: {
          select: {
            id: true,
            taskId: true,
            dependsOnTaskId: true,
            type: true,
            lagDays: true,
          },
        },
      },
      orderBy: [{ startDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.resourceAssignment.findMany({
      where: {
        task: {
          projectId,
        },
      },
      select: {
        id: true,
        taskId: true,
        memberId: true,
        equipmentId: true,
        units: true,
        member: {
          select: {
            id: true,
            name: true,
            capacity: true,
          },
        },
        equipment: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const dependencies = tasks.flatMap((task) => task.dependencies);
  const capacities = new Map<string, ResourceCapacityInput>();

  for (const assignment of assignments) {
    if (assignment.memberId && assignment.member) {
      capacities.set(`member:${assignment.memberId}`, {
        resourceKey: `member:${assignment.memberId}`,
        resourceId: assignment.memberId,
        resourceType: "member",
        label: assignment.member.name,
        capacityUnits: Math.max(0.1, assignment.member.capacity / 100),
      });
    }

    if (assignment.equipmentId) {
      capacities.set(`equipment:${assignment.equipmentId}`, {
        resourceKey: `equipment:${assignment.equipmentId}`,
        resourceId: assignment.equipmentId,
        resourceType: "equipment",
        label: assignment.equipment?.name ?? assignment.equipmentId,
        capacityUnits: 1,
      });
    }
  }

  return {
    project,
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
    dependencies,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      taskId: assignment.taskId,
      memberId: assignment.memberId,
      equipmentId: assignment.equipmentId,
      units: assignment.units,
    })),
    capacities: [...capacities.values()],
  };
}

export function serializeCriticalPath(result: CriticalPathResult) {
  return {
    projectStart: result.projectStart.toISOString(),
    projectFinish: result.projectFinish.toISOString(),
    criticalPath: result.criticalPath,
    tasks: result.tasks.map((task) => ({
      ...task,
      earliestStart: task.earliestStart.toISOString(),
      earliestFinish: task.earliestFinish.toISOString(),
      latestStart: task.latestStart.toISOString(),
      latestFinish: task.latestFinish.toISOString(),
    })),
  };
}
