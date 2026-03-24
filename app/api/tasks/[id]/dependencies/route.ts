import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildTaskDependencySummary } from "@/lib/tasks/dependency-insights";

/**
 * GET /api/tasks/[id]/dependencies — Get task dependencies
 * POST /api/tasks/[id]/dependencies — Add dependency
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        status: true,
        dependencies: {
          select: {
            id: true,
            type: true,
            dependsOnTask: {
              select: {
                id: true,
                title: true,
                status: true,
                dueDate: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      return notFound("Task not found");
    }

    const dependencies = await prisma.taskDependency.findMany({
      where: {
        taskId: id,
        task: { projectId: task.projectId },
        dependsOnTask: { projectId: task.projectId },
      },
      include: {
        dependsOnTask: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
          },
        },
      },
    });

    const dependents = await prisma.taskDependency.findMany({
      where: {
        dependsOnTaskId: id,
        task: { projectId: task.projectId },
        dependsOnTask: { projectId: task.projectId },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
          },
        },
      },
    });

    const projectEdges = await prisma.taskDependency.findMany({
      where: {
        task: { projectId: task.projectId },
        dependsOnTask: { projectId: task.projectId },
      },
      select: {
        taskId: true,
        dependsOnTaskId: true,
        task: {
          select: {
            projectId: true,
          },
        },
      },
    });

    const summary = buildTaskDependencySummary(
      {
        id: task.id,
        projectId: task.projectId,
        status: task.status,
        dependencies: task.dependencies.map((dependency) => ({
          id: dependency.id,
          type: dependency.type,
          task: dependency.dependsOnTask,
        })),
      },
      projectEdges.map((edge) => ({
        taskId: edge.taskId,
        dependsOnTaskId: edge.dependsOnTaskId,
        projectId: edge.task.projectId,
      }))
    );

    return NextResponse.json({
      summary,
      dependencies: dependencies.map((d) => ({
        id: d.id,
        type: d.type,
        isBlocking: d.dependsOnTask.status !== "done",
        task: d.dependsOnTask,
      })),
      dependents: dependents.map((d) => ({
        id: d.id,
        type: d.type,
        isBlockedByCurrentTask: task.status !== "done",
        task: d.task,
      })),
    });
  } catch (error) {
    console.error("[Dependencies API] Error:", error);
    return serverError(error, "Failed to fetch task dependencies.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;
    const body = await request.json();
    const { dependsOnTaskId, type = "FINISH_TO_START" } = body;

    if (!dependsOnTaskId) {
      return badRequest("dependsOnTaskId is required");
    }

    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });

    if (!task) {
      return notFound("Task not found");
    }

    const dependsOnTask = await prisma.task.findUnique({
      where: { id: dependsOnTaskId },
      select: { id: true, projectId: true },
    });

    if (!dependsOnTask) {
      return notFound("Dependency task not found");
    }

    if (dependsOnTask.projectId !== task.projectId) {
      return badRequest("Dependencies must stay within the same project");
    }

    const hasCircular = await checkCircularDependency(
      id,
      dependsOnTaskId,
      task.projectId
    );
    if (hasCircular) {
      return badRequest("Circular dependency detected");
    }

    // Check if dependency already exists
    const existing = await prisma.taskDependency.findUnique({
      where: {
        taskId_dependsOnTaskId: {
          taskId: id,
          dependsOnTaskId,
        },
      },
    });

    if (existing) {
      return badRequest("Dependency already exists");
    }

    const dependency = await prisma.taskDependency.create({
      data: {
        id: randomUUID(),
        taskId: id,
        dependsOnTaskId,
        type,
      },
      include: {
        dependsOnTask: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        ...dependency,
        task: dependency.dependsOnTask,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Dependencies API] Error:", error);
    return serverError(error, "Failed to create task dependency.");
  }
}

/**
 * Check for circular dependency using DFS
 */
async function checkCircularDependency(
  taskId: string,
  dependsOnTaskId: string,
  projectId: string
): Promise<boolean> {
  const visited = new Set<string>();
  const stack = [dependsOnTaskId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    
    if (current === taskId) {
      return true; // Circular dependency found
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const deps = await prisma.taskDependency.findMany({
      where: {
        taskId: current,
        task: { projectId },
        dependsOnTask: { projectId },
      },
      select: { dependsOnTaskId: true },
    });

    stack.push(...deps.map((d) => d.dependsOnTaskId));
  }

  return false;
}
