import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { autoScheduleTasks } from "@/lib/scheduling/auto-schedule";
import { buildProjectGanttSnapshot } from "@/lib/scheduling/gantt-payload";
import { getProjectSchedulingContext } from "@/lib/scheduling/service";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

// GET /api/projects/[id]/gantt
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authorizeRequest(req, {
      permission: "MANAGE_TASKS",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const snapshot = await buildProjectGanttSnapshot(id);
    if (!snapshot) {
      return notFound("Project not found");
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    return serverError(error, "Failed to fetch gantt data.");
  }
}

// PATCH /api/projects/[id]/gantt
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authorizeRequest(req, {
      permission: "VIEW_TASKS",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;
    const body = await req.json();
    const { taskId, endDate, startDate, percentComplete, isManualSchedule } = body;

    if (!taskId) {
      return badRequest("taskId is required");
    }

    if (startDate && Number.isNaN(new Date(startDate).getTime())) {
      return badRequest("Invalid startDate");
    }

    if (endDate && Number.isNaN(new Date(endDate).getTime())) {
      return badRequest("Invalid endDate");
    }

    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    });

    if (!existingTask || existingTask.projectId !== id) {
      return notFound("Task not found");
    }

    const updateData: Record<string, unknown> = {};
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.dueDate = new Date(endDate);
    if (typeof percentComplete === "number") updateData.percentComplete = percentComplete;
    if (typeof isManualSchedule === "boolean") updateData.isManualSchedule = isManualSchedule;

    await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    const context = await getProjectSchedulingContext(id);
    if (!context) {
      return notFound("Project not found");
    }

    const scheduleResult = autoScheduleTasks({
      tasks: context.tasks,
      dependencies: context.dependencies,
      projectStart: context.project.start,
      projectEnd: context.project.end,
    });

    const dependentUpdates = scheduleResult.updatedTasks.filter((task) => task.taskId !== taskId);
    if (dependentUpdates.length > 0) {
      await prisma.$transaction(
        dependentUpdates.map((task) =>
          prisma.task.update({
            where: { id: task.taskId },
            data: {
              startDate: task.newStartDate,
              dueDate: task.newDueDate,
            },
          })
        )
      );
    }

    const snapshot = await buildProjectGanttSnapshot(id);
    return NextResponse.json({
      updatedTaskId: taskId,
      dependentUpdates: dependentUpdates.length,
      gantt: snapshot,
    });
  } catch (error) {
    return serverError(error, "Failed to update task.");
  }
}
