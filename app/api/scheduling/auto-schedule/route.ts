import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { autoScheduleTasks } from "@/lib/scheduling/auto-schedule";
import { getProjectSchedulingContext, serializeCriticalPath } from "@/lib/scheduling/service";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
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
    const body = (await request.json()) as { projectId?: string };
    const projectId = body.projectId?.trim();

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const context = await getProjectSchedulingContext(projectId);
    if (!context) {
      return notFound("Project not found");
    }

    const result = autoScheduleTasks({
      tasks: context.tasks,
      dependencies: context.dependencies,
      projectStart: context.project.start,
      projectEnd: context.project.end,
    });

    if (result.updatedTasks.length > 0) {
      await prisma.$transaction(
        result.updatedTasks.map((task) =>
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

    return NextResponse.json({
      updatedCount: result.updatedTasks.length,
      criticalPath: serializeCriticalPath(result.criticalPath),
      tasks: result.updatedTasks.map((task) => ({
        ...task,
        oldStartDate: task.oldStartDate.toISOString(),
        newStartDate: task.newStartDate.toISOString(),
        oldDueDate: task.oldDueDate.toISOString(),
        newDueDate: task.newDueDate.toISOString(),
      })),
    });
  } catch (error) {
    return serverError(error, "Failed to auto-schedule project tasks.");
  }
}
