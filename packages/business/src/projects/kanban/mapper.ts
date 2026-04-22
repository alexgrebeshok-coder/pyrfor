import {
  normalizeProjectStatus,
  normalizeTaskDependencySummary,
  normalizeTaskStatus,
} from "@/lib/client/normalizers";
import type { Board, Task as KanbanTask } from "@/lib/types";

type BoardRecord = {
  id: string;
  name: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
    status: string;
    progress: number | null;
  } | null;
  columns: Array<{
    id: string;
    title: string;
    order: number;
    color: string | null;
    boardId: string;
    createdAt: Date;
    updatedAt: Date;
      tasks: Array<{
        id: string;
        title: string;
        description: string | null;
      status: string;
      priority: string;
      order: number;
      dueDate: Date;
      completedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        projectId: string;
        assigneeId: string | null;
        blockedReason?: string | null;
        dependencySummary?: {
          dependencyCount: number;
          dependentCount: number;
          blockingDependencyCount: number;
          downstreamImpactCount: number;
          blockedByDependencies: boolean;
          earliestBlockingDueDate: string | null;
          blockingDependencies: Array<{
            id: string;
            title: string;
            status: string;
            dueDate: string;
            type: string;
          }>;
        } | null;
        assignee: {
          id: string;
          name: string;
        initials: string | null;
      } | null;
    }>;
  }>;
};

export function mapBoardRecordToView(board: BoardRecord): Board {
  return {
    id: board.id,
    name: board.name,
    projectId: board.projectId,
    project: board.project
      ? {
          id: board.project.id,
          name: board.project.name,
          status: normalizeProjectStatus(board.project.status),
          progress: board.project.progress ?? 0,
        }
      : undefined,
    columns: board.columns.map((column) => ({
      id: column.id,
      title: column.title,
      order: column.order,
      color: column.color ?? undefined,
      boardId: column.boardId,
      createdAt: column.createdAt.toISOString(),
      updatedAt: column.updatedAt.toISOString(),
      tasks: column.tasks.map((task) => {
        const status = normalizeTaskStatus(task.status);

        return {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          description: task.description ?? "",
          status,
          order: task.order,
          assignee: task.assignee
            ? {
                id: task.assignee.id,
                name: task.assignee.name,
                initials: task.assignee.initials,
              }
            : null,
          dueDate: task.dueDate.toISOString(),
          priority: task.priority as KanbanTask["priority"],
          tags: [],
          createdAt: task.createdAt.toISOString(),
          blockedReason:
            task.blockedReason?.trim() ||
            (status === "blocked"
              ? "Task is blocked, but no reason is linked in the API workflow yet."
              : undefined),
          dependencySummary: normalizeTaskDependencySummary(task.dependencySummary),
        };
      }),
    })),
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}
