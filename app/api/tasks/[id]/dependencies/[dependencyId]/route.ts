import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * DELETE /api/tasks/[id]/dependencies/[dependencyId] — Remove dependency
 */

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dependencyId: string }> }
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

    const { id, dependencyId } = await params;

    const dependency = await prisma.taskDependency.findUnique({
      where: { id: dependencyId },
      select: { id: true, taskId: true },
    });

    if (!dependency || dependency.taskId !== id) {
      return notFound("Task dependency not found");
    }

    const deleteResult = await prisma.taskDependency.deleteMany({
      where: {
        id: dependencyId,
        taskId: id,
      },
    });

    if (deleteResult.count === 0) {
      return notFound("Task dependency not found");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Dependency DELETE] Error:", error);
    return serverError(error, "Failed to delete task dependency.");
  }
}
