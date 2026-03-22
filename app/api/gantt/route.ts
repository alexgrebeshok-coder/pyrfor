/**
 * GET /api/gantt
 * Returns aggregated Gantt data for the portfolio view.
 */

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

interface GanttProject {
  id: string;
  name: string;
  start: string;
  end: string;
  status: string;
  progress: number | null;
}

interface GanttTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies: string[];
  type?: string;
  projectId?: string;
}

interface GanttResponse {
  projects: GanttProject[];
  tasks: GanttTask[];
}

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

    const [projects, tasks] = await Promise.all([
      prisma.project.findMany({
        where: projectId ? { id: projectId } : undefined,
        select: {
          id: true,
          name: true,
          start: true,
          end: true,
          status: true,
          progress: true,
        },
      }),
      prisma.task.findMany({
        where: projectId ? { projectId } : undefined,
        include: {
          dependencies: {
            select: {
              dependsOnTaskId: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const tasksPayload: GanttTask[] = tasks.map((task) => {
      const startDate = task.createdAt;
      const endDate =
        task.dueDate ?? new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const progress = task.status === "done" ? 100 : task.status === "in_progress" ? 50 : 0;

        return {
          id: task.id,
          name: task.title,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          progress,
          dependencies: task.dependencies.map(
            (dependency) => dependency.dependsOnTaskId
          ),
          type: task.status,
          projectId: task.projectId,
        };
    });

    const projectPayload: GanttProject[] = projects.map((project) => ({
      id: project.id,
      name: project.name,
      start: project.start.toISOString(),
      end: project.end.toISOString(),
      status: project.status,
      progress: project.progress,
    }));

    const payload: GanttResponse = {
      projects: projectPayload,
      tasks: tasksPayload,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Gantt API] Error:", error);
    return serverError(error, "Failed to load gantt data.");
  }
}
