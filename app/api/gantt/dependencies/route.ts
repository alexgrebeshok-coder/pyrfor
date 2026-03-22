import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/gantt/dependencies — Dependencies for Gantt chart
 * 
 * Returns task dependencies with positions for rendering lines
 */

export async function GET(request: NextRequest) {
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

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() || null;

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const dependencies = await prisma.taskDependency.findMany({
      where: {
        task: {
          projectId,
        },
        dependsOnTask: {
          projectId,
        },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            dueDate: true,
            status: true,
          },
        },
        dependsOnTask: {
          select: {
            id: true,
            title: true,
            dueDate: true,
            status: true,
          },
        },
      },
    });

    // Format for Gantt rendering
    const links = dependencies.map((dep) => ({
      id: dep.id,
      type: dep.type,
      source: dep.dependsOnTaskId,
      target: dep.taskId,
      sourceTask: dep.dependsOnTask.title,
      targetTask: dep.task.title,
      sourceDate: dep.dependsOnTask.dueDate,
      targetDate: dep.task.dueDate,
    }));

    return NextResponse.json(links);
  } catch (error) {
    console.error("[Gantt Dependencies API] Error:", error);
    return serverError(error, "Failed to fetch gantt dependencies.");
  }
}
