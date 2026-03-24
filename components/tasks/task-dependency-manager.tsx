"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trash2, Link2, AlertCircle } from "lucide-react";
import type { Task } from "@/lib/types";

interface TaskDependencyManagerProps {
  taskId: string;
  projectId: string;
}

interface Dependency {
  id: string;
  type: string;
  isBlocking?: boolean;
  isBlockedByCurrentTask?: boolean;
  task: {
    id: string;
    title: string;
    status: string;
    dueDate: string;
  };
}

interface DependenciesResponse {
  summary?: {
    dependencyCount: number;
    dependentCount: number;
    blockingDependencyCount: number;
    downstreamImpactCount: number;
    earliestBlockingDueDate: string | null;
  };
  dependencies: Dependency[];
  dependents: Dependency[];
}

export const TaskDependencyManager = React.memo(function TaskDependencyManager({
  taskId,
  projectId,
}: TaskDependencyManagerProps) {
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [dependents, setDependents] = useState<Dependency[]>([]);
  const [availableTasks, setAvailableTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [summary, setSummary] = useState<DependenciesResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use ref to avoid stale closure
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;

  const fetchDependencies = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/dependencies`);
      const data: DependenciesResponse = await response.json();
      setSummary(data.summary ?? null);
      setDependencies(data.dependencies);
      setDependents(data.dependents);
    } catch (err) {
      console.error("[TaskDependencyManager] Error:", err);
      setError("Не удалось загрузить зависимости");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchAvailableTasks = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks`);
      const tasks = await response.json();
      // Filter out current task and tasks already in dependencies
      // Use ref to avoid stale closure
      const depIds = new Set(dependenciesRef.current.map((d) => d.task.id));
      const filtered = tasks.filter(
        (t: Task) => t.id !== taskId && !depIds.has(t.id)
      );
      setAvailableTasks(filtered);
    } catch (err) {
      console.error("[TaskDependencyManager] Error fetching tasks:", err);
    }
  }, [projectId, taskId]); // Remove 'dependencies' from deps - use ref instead

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);

  useEffect(() => {
    if (dependencies.length >= 0) {
      fetchAvailableTasks();
    }
  }, [fetchAvailableTasks, dependencies.length]);

  const handleAddDependency = useCallback(async () => {
    if (!selectedTaskId) return;

    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dependsOnTaskId: selectedTaskId,
          type: "FINISH_TO_START",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add dependency");
      }

      setSelectedTaskId("");
      fetchDependencies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка добавления");
    }
  }, [selectedTaskId, taskId, fetchDependencies]);

  const handleRemoveDependency = useCallback(async (dependencyId: string) => {
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${taskId}/dependencies/${dependencyId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to remove dependency");
      }

      fetchDependencies();
    } catch (err) {
      setError("Ошибка удаления зависимости");
      console.error("[TaskDependencyManager] Error removing:", err);
    }
  }, [taskId, fetchDependencies]);

  if (loading) {
    return (
      <div className="py-4 text-center text-sm text-[var(--ink-muted)]">
        Загрузка...
      </div>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[var(--accent)]" />
        <h3 className="font-medium">Зависимости</h3>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {summary ? (
        <div className="mb-4 grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-secondary)] p-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral" className="text-xs">
              Dependencies: {summary.dependencyCount}
            </Badge>
            <Badge variant="neutral" className="text-xs">
              Direct dependents: {summary.dependentCount}
            </Badge>
            {summary.blockingDependencyCount > 0 ? (
              <Badge variant="warning" className="text-xs">
                Waiting on: {summary.blockingDependencyCount}
              </Badge>
            ) : null}
            {summary.downstreamImpactCount > 0 ? (
              <Badge variant="info" className="text-xs">
                Downstream impact: {summary.downstreamImpactCount}
              </Badge>
            ) : null}
          </div>
          {summary.earliestBlockingDueDate ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Earliest unblock after {new Date(summary.earliestBlockingDueDate).toLocaleDateString("ru-RU")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Dependencies (this task depends on) */}
      {dependencies.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-[var(--ink-muted)]">
            ЗАВИСИТ ОТ
          </p>
          <div className="space-y-2">
            {dependencies.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center justify-between rounded-md bg-[var(--surface-secondary)] p-2"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="neutral" className="text-xs">
                    {dep.type.replace("_", " ")}
                  </Badge>
                  {dep.isBlocking ? (
                    <Badge variant="warning" className="text-xs">
                      waiting
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-xs">
                      clear
                    </Badge>
                  )}
                  <span className="text-sm">{dep.task.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveDependency(dep.id)}
                  aria-label="Удалить зависимость"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependents (tasks that depend on this) */}
      {dependents.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-[var(--ink-muted)]">
            ЗАВИСЯТ ОТ ЭТОЙ
          </p>
          <div className="space-y-2">
            {dependents.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center gap-2 rounded-md bg-[var(--surface-secondary)] p-2"
              >
                <ArrowRight className="h-4 w-4 text-[var(--ink-muted)]" />
                {dep.isBlockedByCurrentTask ? (
                  <Badge variant="warning" className="text-xs">
                    affected
                  </Badge>
                ) : (
                  <Badge variant="success" className="text-xs">
                    clear
                  </Badge>
                )}
                <span className="text-sm">{dep.task.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add dependency */}
      {availableTasks.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
            aria-label="Выберите задачу для зависимости"
          >
            <option value="">Выберите задачу...</option>
            {availableTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={handleAddDependency}
            disabled={!selectedTaskId}
          >
            Добавить
          </Button>
        </div>
      )}

      {dependencies.length === 0 && dependents.length === 0 && (
        <p className="text-center text-sm text-[var(--ink-muted)]">
          Нет зависимостей
        </p>
      )}
    </Card>
  );
});
