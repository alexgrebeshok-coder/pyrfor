import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { buildProjectGanttSnapshot } from "@/lib/scheduling/gantt-payload";
import { databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() || null;

  try {
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });

      if (!project) {
        return notFound("Project not found");
      }
    }

    const projects = await prisma.project.findMany({
      where: projectId ? { id: projectId } : undefined,
      select: { id: true },
      orderBy: { start: "asc" },
    });

    const snapshots = (
      await Promise.all(projects.map((project) => buildProjectGanttSnapshot(project.id)))
    ).filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

    return NextResponse.json({
      projects: snapshots.map((snapshot) => snapshot.project),
      tasks: snapshots.flatMap((snapshot) => snapshot.tasks),
      dependencies: snapshots.flatMap((snapshot) => snapshot.dependencies),
    });
  } catch (error) {
    console.error("[Gantt API] Error:", error);
    return serverError(error, "Failed to load gantt data.");
  }
}
