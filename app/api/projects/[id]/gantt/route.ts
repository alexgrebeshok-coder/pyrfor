/**
 * Gantt Chart API
 * Provides task data in Gantt-compatible format
 */

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, databaseUnavailable, notFound } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

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

// GET /api/projects/[id]/gantt
export async function GET(
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

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const tasks = await prisma.task.findMany({
      where: { projectId: id },
      include: {
        dependencies: {
          select: { dependsOnTaskId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const ganttData: GanttTask[] = tasks.map((task) => {
      const startDate = task.createdAt;
      const endDate = task.dueDate || new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const progress = task.status === "done" ? 100 : task.status === "in_progress" ? 50 : 0;
      
      return {
        id: task.id,
        name: task.title,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        progress,
        dependencies: task.dependencies.map((d) => d.dependsOnTaskId),
        type: task.status,
        projectId: task.projectId,
      };
    });

    return NextResponse.json(ganttData);
  } catch (error) {
    console.error("[Project Gantt API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch gantt data" },
      { status: 500 }
    );
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
    const { taskId, endDate } = body;

    if (!taskId) {
      return badRequest("taskId is required");
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
    if (endDate) updateData.dueDate = new Date(endDate);

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    return NextResponse.json(updatedTask);
  } catch (error) {
    console.error("[Project Gantt API] Error:", error);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}
