/**
 * POST /api/tasks/[id]/reschedule — Auto-reschedule dependent tasks
 *
 * Updates the target task, then runs the shared auto-scheduling engine
 * so all downstream tasks follow the same dependency rules as the new
 * scheduling APIs.
 */

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { autoScheduleTasks } from "@/lib/scheduling/auto-schedule";
import {
  addDays,
  getTaskDurationDays,
  type SchedulingTaskInput,
} from "@/lib/scheduling/critical-path";
import { getProjectSchedulingContext } from "@/lib/scheduling/service";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request, {
    permission: "MANAGE_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as { newDueDate?: string; newStartDate?: string };

    if (!body.newDueDate) {
      return badRequest("newDueDate is required");
    }

    const parsedDueDate = new Date(body.newDueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      return badRequest("Invalid newDueDate format");
    }

    const parsedStartDate = body.newStartDate ? new Date(body.newStartDate) : null;
    if (parsedStartDate && Number.isNaN(parsedStartDate.getTime())) {
      return badRequest("Invalid newStartDate format");
    }

    const task = await prisma.task.findUnique({
      where: { id },
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
      },
    });

    if (!task) {
      return notFound("Task not found");
    }

    const schedulingTask: SchedulingTaskInput = {
      ...task,
    };
    const durationDays = getTaskDurationDays(schedulingTask);
    const nextStartDate =
      parsedStartDate ??
      (durationDays === 0 ? parsedDueDate : addDays(parsedDueDate, -(durationDays - 1)));

    await prisma.task.update({
      where: { id },
      data: {
        startDate: nextStartDate,
        dueDate: parsedDueDate,
      },
    });

    const context = await getProjectSchedulingContext(task.projectId);
    if (!context) {
      return notFound("Project not found");
    }

    const result = autoScheduleTasks({
      tasks: context.tasks,
      dependencies: context.dependencies,
      projectStart: context.project.start,
      projectEnd: context.project.end,
    });

    const downstreamUpdates = result.updatedTasks.filter((update) => update.taskId !== id);

    if (downstreamUpdates.length > 0) {
      await prisma.$transaction(
        downstreamUpdates.map((update) =>
          prisma.task.update({
            where: { id: update.taskId },
            data: {
              startDate: update.newStartDate,
              dueDate: update.newDueDate,
            },
          })
        )
      );
    }

    return NextResponse.json({
      rescheduledCount: downstreamUpdates.length,
      tasks: downstreamUpdates.map((update) => ({
        taskId: update.taskId,
        taskTitle: update.title,
        oldStartDate: update.oldStartDate.toISOString(),
        newStartDate: update.newStartDate.toISOString(),
        oldDueDate: update.oldDueDate.toISOString(),
        newDueDate: update.newDueDate.toISOString(),
        durationDays: update.durationDays,
        totalFloatDays: update.totalFloatDays,
        isCritical: update.isCritical,
      })),
    });
  } catch (error) {
    return serverError(error, "Failed to reschedule tasks.");
  }
}
