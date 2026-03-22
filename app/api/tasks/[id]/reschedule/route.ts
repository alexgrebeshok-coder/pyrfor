/**
 * POST /api/tasks/[id]/reschedule — Auto-reschedule dependent tasks
 * 
 * Called when a task's due date changes
 * Recursively updates all dependent tasks based on dependency type
 */

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

const MAX_RECURSION_DEPTH = 50;

interface RescheduleResult {
  taskId: string;
  taskTitle: string;
  oldDueDate: Date;
  newDueDate: Date;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;
    const body = await request.json();
    const { newDueDate } = body;

    if (!newDueDate) {
      return badRequest("newDueDate is required");
    }

    // Validate date
    const parsedDate = new Date(newDueDate);
    if (isNaN(parsedDate.getTime())) {
      return badRequest("Invalid date format");
    }

    // Get the task
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, title: true, dueDate: true, projectId: true },
    });

    if (!task) {
      return notFound("Task not found");
    }

    // Use transaction for atomic updates
    const results = await prisma.$transaction(async (tx) => {
      const rescheduleResults: RescheduleResult[] = [];

      const dependents = await tx.taskDependency.findMany({
        where: {
          dependsOnTaskId: id,
          task: {
            projectId: task.projectId,
          },
          dependsOnTask: {
            projectId: task.projectId,
          },
        },
        include: {
          task: {
            select: { id: true, title: true, dueDate: true },
          },
        },
      });

      for (const dep of dependents) {
        const dependentTask = dep.task;
        const oldDueDate = dependentTask.dueDate;

        // Calculate new due date based on dependency type
        let updatedDueDate: Date | null = null;

        switch (dep.type) {
          case "FINISH_TO_START":
            // Dependent task starts after this task finishes
            if (oldDueDate < parsedDate) {
              updatedDueDate = parsedDate;
            }
            break;

          case "START_TO_START":
            // Both tasks should start around the same time
            if (oldDueDate.getTime() !== parsedDate.getTime()) {
              updatedDueDate = parsedDate;
            }
            break;
        }

        if (updatedDueDate) {
          await tx.task.update({
            where: { id: dependentTask.id },
            data: { dueDate: updatedDueDate },
          });

          rescheduleResults.push({
            taskId: dependentTask.id,
            taskTitle: dependentTask.title,
            oldDueDate,
            newDueDate: updatedDueDate,
          });

          const recursiveResults = await rescheduleRecursive(
            tx,
            dependentTask.id,
            updatedDueDate,
            task.projectId,
            0
          );
          rescheduleResults.push(...recursiveResults);
        }
      }

      return rescheduleResults;
    });

    return NextResponse.json({
      rescheduledCount: results.length,
      tasks: results,
    });
  } catch (error) {
    console.error("[Reschedule API] Error:", error);
    
    if (error instanceof Error && error.message === "Max recursion depth exceeded") {
      return badRequest("Dependency chain too deep (possible circular dependency)");
    }
    
    return serverError(error, "Failed to reschedule tasks.");
  }
}

/**
 * Recursively reschedule dependent tasks with depth limit
 */
async function rescheduleRecursive(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  taskId: string,
  newDueDate: Date,
  projectId: string,
  depth: number
): Promise<RescheduleResult[]> {
  if (depth >= MAX_RECURSION_DEPTH) {
    throw new Error("Max recursion depth exceeded");
  }

  const results: RescheduleResult[] = [];

  const dependents = await tx.taskDependency.findMany({
    where: {
      dependsOnTaskId: taskId,
      task: {
        projectId,
      },
      dependsOnTask: {
        projectId,
      },
    },
    include: {
      task: {
        select: { id: true, title: true, dueDate: true },
      },
    },
  });

  for (const dep of dependents) {
    const dependentTask = dep.task;
    const oldDueDate = dependentTask.dueDate;

    if (dep.type === "FINISH_TO_START" && oldDueDate < newDueDate) {
      await tx.task.update({
        where: { id: dependentTask.id },
        data: { dueDate: newDueDate },
      });

      results.push({
        taskId: dependentTask.id,
        taskTitle: dependentTask.title,
        oldDueDate,
        newDueDate,
      });

      const recursiveResults = await rescheduleRecursive(
        tx,
        dependentTask.id,
        newDueDate,
        projectId,
        depth + 1
      );
      results.push(...recursiveResults);
    }
  }

  return results;
}
