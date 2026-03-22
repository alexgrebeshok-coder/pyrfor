import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { mapBoardRecordToView } from "@/lib/kanban/mapper";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/boards/[id] — Get board with columns and tasks
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

    const board = await prisma.board.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            progress: true,
          },
        },
        columns: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            order: true,
            color: true,
            boardId: true,
            createdAt: true,
            updatedAt: true,
            tasks: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                order: true,
                dueDate: true,
                completedAt: true,
                createdAt: true,
                updatedAt: true,
                projectId: true,
                assigneeId: true,
                assignee: {
                  select: { id: true, name: true, initials: true },
                },
              },
            },
          },
        },
      },
    });

    if (!board || !board.project) {
      return notFound("Board not found");
    }

    return NextResponse.json(mapBoardRecordToView(board));
  } catch (error) {
    console.error("[Board API] Error:", error);
    return serverError(error, "Failed to fetch board.");
  }
}
