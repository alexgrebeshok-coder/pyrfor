import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  isPrismaNotFoundError,
  normalizeTaskStatus,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { enrichTaskWithDependencyInsights } from "@/lib/tasks/dependency-insights";
import { updateTaskSchema } from "@/lib/validators/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const authResult = await authorizeRequest(_request, {
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
    });

    if (!task) {
      return notFound("Task not found");
    }

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

    const enrichedTask = enrichTaskWithDependencyInsights(
      {
        ...task,
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
      ...enrichedTask,
      dependencies: undefined,
    });
  } catch (error) {
    return serverError(error, "Failed to load task.");
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
    const parsed = await validateBody(request, updateTaskSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const { assigneeId, description, dueDate, order, priority, status, title } = parsed;
    const nextStatus = normalizeTaskStatus(status);

    let currentTask:
      | {
          id: string;
          projectId: string;
          status: string;
          percentComplete: number | null;
        }
      | null = null;
    let orderUpdate: Record<string, unknown> = {};
    let statusProgressUpdate: Record<string, unknown> = {};
    if (nextStatus) {
      currentTask = await prisma.task.findUnique({
        where: { id },
        select: { id: true, projectId: true, status: true, percentComplete: true },
      });

      if (!currentTask) {
        return notFound("Task not found");
      }

      if (currentTask.status !== nextStatus) {
        const maxOrder = await prisma.task.aggregate({
          where: {
            projectId: currentTask.projectId,
            status: nextStatus,
          },
          _max: { order: true },
        });

        orderUpdate = { order: (maxOrder._max.order ?? -1) + 1 };
      }

      if (nextStatus === "done") {
        statusProgressUpdate = { percentComplete: 100 };
      } else if (currentTask.status === "done" && currentTask.percentComplete === 100) {
        statusProgressUpdate =
          nextStatus === "in_progress"
            ? { percentComplete: 50 }
            : { percentComplete: 0 };
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(nextStatus && { status: nextStatus, ...orderUpdate, ...statusProgressUpdate }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
        ...(order !== undefined && { order }),
        ...(nextStatus === "done"
          ? { completedAt: new Date() }
          : nextStatus
            ? { completedAt: null }
            : {}),
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

    return NextResponse.json({
      ...task,
      project: task.project,
      assignee: task.assignee,
    });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Task not found");
    }

    return serverError(error, "Failed to update task.");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const authResult = await authorizeRequest(_request, {
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
    await prisma.task.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Task not found");
    }

    return serverError(error, "Failed to delete task.");
  }
}
