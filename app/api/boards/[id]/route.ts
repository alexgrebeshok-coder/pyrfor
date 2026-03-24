import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { enrichTasksWithDependencyInsights } from "@/lib/tasks/dependency-insights";
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
            },
          },
        },
      },
    });

    if (!board || !board.project) {
      return notFound("Board not found");
    }

    const projectEdges = await prisma.taskDependency.findMany({
      where: {
        task: { projectId: board.projectId },
        dependsOnTask: { projectId: board.projectId },
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

    const boardWithInsights = {
      ...board,
      columns: board.columns.map((column) => ({
        ...column,
        tasks: enrichTasksWithDependencyInsights(
          column.tasks.map((task) => ({
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
        ),
      })),
    };

    return NextResponse.json(mapBoardRecordToView(boardWithInsights));
  } catch (error) {
    console.error("[Board API] Error:", error);
    return serverError(error, "Failed to fetch board.");
  }
}
