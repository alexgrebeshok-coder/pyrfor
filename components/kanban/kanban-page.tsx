"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KanbanBoard } from "@/components/kanban/kanban-board";
import { DataErrorState } from "@/components/ui/data-error-state";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import { api } from "@/lib/client/api-error";
import { useProjects } from "@/lib/hooks/use-api";
import type { Board } from "@/lib/types";

const BOARD_STATUS_WEIGHT: Record<string, number> = {
  active: 4,
  planning: 3,
  at_risk: 2,
  on_hold: 1,
  completed: 0,
};

function boardLaunchScore(board: Board): number {
  const statusWeight = board.project?.status
    ? BOARD_STATUS_WEIGHT[board.project.status.replace("-", "_")] ?? -1
    : -1;
  const progress = board.project?.progress ?? 0;

  return statusWeight * 1000 + progress;
}

function projectLaunchScore(project: { status: string; progress?: number }): number {
  const statusWeight = BOARD_STATUS_WEIGHT[project.status.replace("-", "_")] ?? -1;
  return statusWeight * 1000 + (project.progress ?? 0);
}

function sortBoardsForLaunch(a: Board, b: Board): number {
  const scoreDelta = boardLaunchScore(b) - boardLaunchScore(a);
  if (scoreDelta !== 0) return scoreDelta;

  return a.name.localeCompare(b.name, "ru");
}

function getProjectStatusLabel(status?: string): string | null {
  switch (status) {
    case "active":
      return "В работе";
    case "planning":
      return "Планирование";
    case "at_risk":
      return "Риск";
    case "on_hold":
      return "Пауза";
    case "completed":
      return "Готово";
    default:
      return null;
  }
}

function isBoard(input: unknown): input is Board {
  return Boolean(
    input &&
      typeof input === "object" &&
      "id" in input &&
      typeof (input as Board).id === "string" &&
      "columns" in input &&
      Array.isArray((input as Board).columns)
  );
}

function isBoardCollection(input: unknown): input is Board[] {
  return Array.isArray(input) && input.every(isBoard);
}

export function KanbanPage() {
  const { t } = useLocale();
  const { error: projectsError, isLoading: projectsLoading, projects } = useProjects();
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const resolveBoard = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setIsLoadingBoard(true);
    setLoadError(null);

    try {
      const boardsPayload = await api.get<unknown>("/api/boards");
      const boards = isBoardCollection(boardsPayload) ? boardsPayload.slice().sort(sortBoardsForLaunch) : [];
      setBoards(boards);

      if (boards[0]?.id) {
        setBoardId((currentBoardId) => {
          if (currentBoardId && boards.some((board) => board.id === currentBoardId)) {
            return currentBoardId;
          }

          return boards[0].id;
        });
        return;
      }

      const firstProject = [...projects]
        .sort((left, right) => projectLaunchScore(right) - projectLaunchScore(left))[0];
      if (!firstProject) {
        setBoardId(null);
        return;
      }

      const createdBoardPayload = await api.post<unknown>("/api/boards", {
        name: "Основная доска",
        projectId: firstProject.id,
      });

      if (!isBoard(createdBoardPayload)) {
        throw new Error(t("error.loadDescription"));
      }

      setBoards((current) =>
        [createdBoardPayload, ...current].sort(sortBoardsForLaunch)
      );
      setBoardId(createdBoardPayload.id);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("error.loadDescription");
      setBoardId(null);
      setLoadError(message);
    } finally {
      inFlightRef.current = false;
      setIsLoadingBoard(false);
    }
  }, [projects, t]);

  const prioritizedBoards = useMemo(() => [...boards].sort(sortBoardsForLaunch), [boards]);

  useEffect(() => {
    if (projectsLoading) return;
    void resolveBoard();
  }, [projectsLoading, resolveBoard]);

  if (projectsLoading || isLoadingBoard) {
    return (
      <div className="grid gap-3" data-testid="kanban-page-loading">
        <Card className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0 space-y-1">
            <div className="h-3 w-28 animate-pulse rounded bg-[var(--surface-secondary)]" />
            <div className="h-4 w-52 animate-pulse rounded bg-[var(--surface-secondary)]" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--surface-secondary)]" />
        </Card>
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {[...Array(4)].map((_, index) => (
            <Card key={index} className="flex w-60 min-w-[256px] flex-col">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-2 py-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-[var(--surface-secondary)]" />
                <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-secondary)]" />
                <div className="ml-auto h-3 w-4 animate-pulse rounded bg-[var(--surface-secondary)]" />
              </div>
              <div className="space-y-1 p-1.5">
                {[...Array(2)].map((__, taskIndex) => (
                  <div
                    key={taskIndex}
                    className="h-16 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface-secondary)]/60"
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || (projectsError && !boardId)) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={loadError ?? t("error.loadDescription")}
        onRetry={() => {
          void resolveBoard();
        }}
        title={t("error.loadTitle")}
      />
    );
  }

  if (!projects.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">{t("kanban.noProject")}</h1>
          <p className="text-[var(--ink-muted)]">
            {t("kanban.emptyDescription")}
          </p>
        </div>
      </div>
    );
  }

  if (!boardId) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={t("error.loadDescription")}
        onRetry={() => {
          void resolveBoard();
        }}
        title={t("error.loadTitle")}
      />
    );
  }

  const activeBoard = prioritizedBoards.find((board) => board.id === boardId) ?? null;

  return (
    <div className="grid min-w-0 gap-3">
      {prioritizedBoards.length > 1 ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Доска
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--ink-soft)]">
                {activeBoard?.project?.name ? `${activeBoard.project.name} · ${activeBoard.name}` : "Выберите рабочую доску"}
              </p>
              {activeBoard?.project?.status ? (
                <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--panel-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                  {getProjectStatusLabel(activeBoard.project.status)}
                  {typeof activeBoard.project.progress === "number" ? ` · ${activeBoard.project.progress}%` : ""}
                </span>
              ) : null}
            </div>
          </div>
          <select
            aria-label="Выбор доски Kanban"
            className="h-9 min-w-[200px] rounded-md border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
            onChange={(event) => setBoardId(event.target.value)}
            value={boardId}
          >
            {prioritizedBoards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.project?.name ? `${board.project.name} · ${board.name}` : board.name}
              </option>
            ))}
          </select>
        </Card>
      ) : null}

      <KanbanBoard boardId={boardId} />
    </div>
  );
}
