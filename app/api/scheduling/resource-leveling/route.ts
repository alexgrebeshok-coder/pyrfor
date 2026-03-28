import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { getProjectSchedulingContext, serializeCriticalPath } from "@/lib/scheduling/service";
import { levelResources } from "@/lib/scheduling/resource-leveling";
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
    const body = (await request.json()) as { projectId?: string; apply?: boolean };
    const projectId = body.projectId?.trim();

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const context = await getProjectSchedulingContext(projectId);
    if (!context) {
      return notFound("Project not found");
    }

    const result = levelResources({
      tasks: context.tasks,
      dependencies: context.dependencies,
      assignments: context.assignments,
      capacities: context.capacities,
      projectStart: context.project.start,
      projectEnd: context.project.end,
    });

    const shouldApply = body.apply !== false;
    if (shouldApply && result.adjustments.length > 0) {
      await prisma.$transaction(
        result.adjustments.map((adjustment) =>
          prisma.task.update({
            where: { id: adjustment.taskId },
            data: {
              startDate: adjustment.newStartDate,
              dueDate: adjustment.newDueDate,
            },
          })
        )
      );
    }

    return NextResponse.json({
      applied: shouldApply,
      conflictCount: result.conflicts.length,
      adjustmentCount: result.adjustments.length,
      criticalPath: serializeCriticalPath(result.criticalPath),
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        date: conflict.date.toISOString(),
      })),
      adjustments: result.adjustments.map((adjustment) => ({
        ...adjustment,
        newStartDate: adjustment.newStartDate.toISOString(),
        newDueDate: adjustment.newDueDate.toISOString(),
      })),
    });
  } catch (error) {
    return serverError(error, "Failed to level project resources.");
  }
}
