import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  normalizeTaskStatus,
  serverError,
  serviceUnavailable,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { enrichTasksWithDependencyInsights } from "@/lib/tasks/dependency-insights";
import { createTaskSchema } from "@/lib/validators/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Require authentication
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return serviceUnavailable(
        "DATABASE_URL is not configured for live mode.",
        "DATABASE_UNAVAILABLE",
        { dataMode: runtime.dataMode }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = normalizeTaskStatus(searchParams.get("status"));
    const priority = searchParams.get("priority");
    const projectId = searchParams.get("projectId");
    const assigneeId = searchParams.get("assigneeId");

    // Pagination support
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status }),
      ...(priority && { priority }),
      ...(projectId && { projectId }),
      ...(assigneeId && { assigneeId }),
    };

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        include: {
          project: {
            select: { id: true, name: true, direction: true },
          },
          assignee: {
            select: { id: true, name: true, initials: true },
          },
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
        orderBy: [{ order: "asc" }, { dueDate: "asc" }],
      }),
      prisma.task.count({ where }),
    ]);

    const projectIds = [...new Set(tasks.map((task) => task.projectId))];
    const projectEdges =
      projectIds.length === 0
        ? []
        : await prisma.taskDependency.findMany({
            where: {
              task: {
                projectId: { in: projectIds },
              },
              dependsOnTask: {
                projectId: { in: projectIds },
              },
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

    const enrichedTasks = enrichTasksWithDependencyInsights(
      tasks.map((task) => ({
        ...task,
        dependencies: task.dependencies.map((dependency) => ({
          id: dependency.id,
          type: dependency.type,
          task: dependency.dependsOnTask,
        })),
      })),
      projectEdges.map((edge) => ({
        taskId: edge.taskId,
        dependsOnTaskId: edge.dependsOnTaskId,
        projectId: edge.task.projectId,
      }))
    );

    return NextResponse.json({
      tasks: enrichedTasks.map((task) => ({
        ...task,
        dependencies: undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to fetch tasks.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "MANAGE_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const parsed = await validateBody(request, createTaskSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const { assigneeId, description, dueDate, order, priority, projectId, status, title } =
      parsed;
    const normalizedStatus = normalizeTaskStatus(status) ?? "todo";

    const maxOrder = await prisma.task.aggregate({
      where: {
        projectId,
        status: normalizedStatus,
      },
      _max: { order: true },
    });

    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        title,
        description,
        projectId,
        assigneeId: assigneeId ?? undefined,
        dueDate: new Date(dueDate),
        status: normalizedStatus,
        percentComplete:
          normalizedStatus === "done"
            ? 100
            : normalizedStatus === "in_progress"
              ? 50
              : 0,
        priority: priority ?? "medium",
        order: order ?? (maxOrder._max.order ?? -1) + 1,
        updatedAt: new Date(),
      },
      include: {
        project: {
          select: { id: true, name: true, direction: true },
        },
        assignee: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    return NextResponse.json(
      {
        ...task,
        project: task.project,
        assignee: task.assignee,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError(error, "Failed to create task.");
  }
}
