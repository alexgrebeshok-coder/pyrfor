/**
 * Assignment costing — calculate labor costs per assignment/task/project
 */

import { prisma } from "@/lib/db";

export interface AssignmentCost {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  resourceId: string;
  resourceName: string;
  hours: number;
  hourlyRate: number;
  totalCost: number;
}

export interface ProjectLaborCost {
  projectId: string;
  projectName: string;
  assignments: AssignmentCost[];
  totalHours: number;
  totalCost: number;
  currency: string;
}

/**
 * Calculate cost for a single assignment
 */
export function computeAssignmentCost(assignment: {
  units: number | null;
  plannedHours: number | null;
  actualHours: number | null;
  costRate: number | null;
  task: { estimatedHours: number | null; title: string };
  member: { hourlyRate: number | null; name: string } | null;
}): { hours: number; hourlyRate: number; totalCost: number } {
  const hours =
    assignment.actualHours ||
    assignment.plannedHours ||
    assignment.task.estimatedHours ||
    0;

  const hourlyRate =
    assignment.costRate ||
    assignment.member?.hourlyRate ||
    0;

  return {
    hours,
    hourlyRate,
    totalCost: Math.round(hours * hourlyRate * 100) / 100,
  };
}

/**
 * Calculate total labor cost for a project
 */
export async function calculateProjectLaborCost(
  projectId: string
): Promise<ProjectLaborCost> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) throw new Error(`Project ${projectId} not found`);

  const assignments = await prisma.resourceAssignment.findMany({
    where: { task: { projectId } },
    include: {
      task: {
        select: { id: true, title: true, estimatedHours: true },
      },
      member: {
        select: { id: true, name: true, hourlyRate: true },
      },
    },
  });

  const costs: AssignmentCost[] = assignments.map((a) => {
    const { hours, hourlyRate, totalCost } = computeAssignmentCost(a);
    return {
      assignmentId: a.id,
      taskId: a.taskId,
      taskTitle: a.task.title,
      resourceId: a.memberId || a.equipmentId || "",
      resourceName: a.member?.name || "Equipment",
      hours,
      hourlyRate,
      totalCost,
    };
  });

  return {
    projectId: project.id,
    projectName: project.name,
    assignments: costs,
    totalHours: costs.reduce((s, c) => s + c.hours, 0),
    totalCost: costs.reduce((s, c) => s + c.totalCost, 0),
    currency: "RUB",
  };
}
