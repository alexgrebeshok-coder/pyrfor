import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  getTaskDurationDays,
  getTaskStartDate,
  type SchedulingTaskInput,
} from "@/lib/scheduling/critical-path";
import { createSchedulingId } from "@/lib/scheduling/service";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  parseOptionalInteger,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function POST(request: NextRequest) {
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
    const body = (await request.json()) as { projectId?: string; baselineNumber?: unknown };
    const projectId = body.projectId?.trim();
    const baselineNumber = parseOptionalInteger(body.baselineNumber) ?? 0;

    if (!projectId) {
      return badRequest("projectId is required");
    }

    if (baselineNumber < 0 || baselineNumber > 10) {
      return badRequest("baselineNumber must be between 0 and 10");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        projectId: true,
        startDate: true,
        dueDate: true,
        estimatedHours: true,
        estimatedCost: true,
        percentComplete: true,
        isMilestone: true,
        isManualSchedule: true,
        constraintType: true,
        constraintDate: true,
      },
    });

    const baselinePayload = tasks.map((task) => {
      const schedulingTask: SchedulingTaskInput = {
        ...task,
      };
      return {
        taskId: task.id,
        baselineNumber,
        startDate: getTaskStartDate(schedulingTask),
        finishDate: task.dueDate,
        duration: getTaskDurationDays(schedulingTask),
        cost: task.estimatedCost,
        work: task.estimatedHours,
      };
    });

    await prisma.$transaction(
      baselinePayload.map((entry) =>
        prisma.taskBaseline.upsert({
          where: {
            taskId_baselineNumber: {
              taskId: entry.taskId,
              baselineNumber: entry.baselineNumber,
            },
          },
          update: {
            startDate: entry.startDate,
            finishDate: entry.finishDate,
            duration: entry.duration,
            cost: entry.cost,
            work: entry.work,
          },
          create: {
            id: createSchedulingId("baseline"),
            taskId: entry.taskId,
            baselineNumber: entry.baselineNumber,
            startDate: entry.startDate,
            finishDate: entry.finishDate,
            duration: entry.duration,
            cost: entry.cost,
            work: entry.work,
          },
        })
      )
    );

    return NextResponse.json({
      projectId,
      baselineNumber,
      savedCount: baselinePayload.length,
    });
  } catch (error) {
    return serverError(error, "Failed to save project baseline.");
  }
}
