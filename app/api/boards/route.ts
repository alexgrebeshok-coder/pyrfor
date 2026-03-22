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
import { mapBoardRecordToView } from "@/lib/kanban/mapper";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/boards — List all boards
 * POST /api/boards — Create new board
 */

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim() || null;
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });

      if (!project) {
        return notFound("Project not found");
      }
    }

    const boards = await prisma.board.findMany({
      where: projectId ? { projectId } : undefined,
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
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(boards.map(mapBoardRecordToView));
  } catch (error) {
    console.error("[Boards API] Error:", error);
    return serverError(error, "Failed to fetch boards.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const { name } = body;
    const projectId =
      typeof body.projectId === "string" ? body.projectId.trim() : "";
    const runtime = getServerRuntimeState();

    if (!name || !projectId) {
      return badRequest("Name and projectId are required");
    }

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    // Create board with default columns
    const board = await prisma.board.create({
      data: {
        id: randomUUID(),
        name,
        projectId,
        columns: {
          create: [
            { id: randomUUID(), title: "To Do", order: 0, color: "#6b7280", updatedAt: new Date() },
            { id: randomUUID(), title: "In Progress", order: 1, color: "#3b82f6", updatedAt: new Date() },
            { id: randomUUID(), title: "Review", order: 2, color: "#f59e0b", updatedAt: new Date() },
            { id: randomUUID(), title: "Done", order: 3, color: "#10b981", updatedAt: new Date() },
          ],
        },
        updatedAt: new Date(),
      },
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

    return NextResponse.json(mapBoardRecordToView(board), { status: 201 });
  } catch (error) {
    console.error("[Boards API] Error:", error);
    return serverError(error, "Failed to create board.");
  }
}
