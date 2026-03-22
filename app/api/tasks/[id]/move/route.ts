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
 * PUT /api/tasks/[id]/move — Move task to another column
 * 
 * Body: { columnId: string, order?: number }
 */

export async function PUT(
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
    const { columnId, order } = body;

    if (!columnId) {
      return badRequest("columnId is required");
    }

    const task = await prisma.task.findUnique({
      where: { id },
      select: { columnId: true, order: true, projectId: true },
    });

    if (!task) {
      return notFound("Task not found");
    }

    const column = await prisma.column.findUnique({
      where: { id: columnId },
      select: {
        id: true,
        title: true,
        board: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (!column) {
      return notFound("Column not found");
    }

    if (column.board.projectId !== task.projectId) {
      return badRequest("Column must belong to the same project as the task");
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        columnId,
        order: order ?? task.order,
        status: getColumnStatus(column.title),
      },
      include: {
        assignee: {
          select: { id: true, name: true, initials: true, avatar: true },
        },
      },
    });

    return NextResponse.json({
      ...updatedTask,
      assignee: updatedTask.assignee,
    });
  } catch (error) {
    console.error("[Task Move API] Error:", error);
    return serverError(error, "Failed to move task.");
  }
}

/**
 * Get task status based on column
 */
function getColumnStatus(columnTitle: string): string {
  const title = columnTitle.toLowerCase();
  if (title.includes("done")) return "done";
  if (title.includes("progress")) return "in_progress";
  if (title.includes("review")) return "in_progress";
  return "todo";
}
