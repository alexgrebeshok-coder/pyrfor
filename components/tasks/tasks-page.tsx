"use client";

import { useMemo, useState } from "react";

import { useDashboard } from "@/components/dashboard-provider";
import { TasksPageView } from "@/components/tasks/tasks-page-view";
import { useProjects, useTasks } from "@/lib/hooks/use-api";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type { Priority, TaskStatus } from "@/lib/types";

export function TasksPage({
  initialQuery = "",
  initialProjectId = "",
  initialTasks = [],
}: {
  initialQuery?: string;
  initialProjectId?: string;
  initialTasks?: ReturnType<typeof useTasks>["tasks"];
}) {
  const { allowed: canManageTasks } = usePlatformPermission("MANAGE_TASKS");
  const { tasks: dashboardTasks, updateTaskStatus } = useDashboard();
  const { error, isLoading, mutate: mutateTasks, tasks: apiTasks } = useTasks();
  const {
    error: projectsError,
    isLoading: projectsLoading,
    mutate: mutateProjects,
    projects,
  } = useProjects();
  const [status, setStatus] = useState<"all" | TaskStatus>("all");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [projectFilter, setProjectFilter] = useState<"all" | string>(initialProjectId || "all");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [dependencyTaskId, setDependencyTaskId] = useState<string | null>(null);

  const mergedTasks = useMemo(() => {
    const taskMap = new Map<string, (typeof dashboardTasks)[number]>();

    for (const task of initialTasks) {
      taskMap.set(task.id, task);
    }

    for (const task of dashboardTasks) {
      taskMap.set(task.id, task);
    }

    for (const task of apiTasks) {
      taskMap.set(task.id, task);
    }

    return Array.from(taskMap.values());
  }, [apiTasks, dashboardTasks, initialTasks]);

  const filteredTasks = useMemo(
    () =>
      mergedTasks.filter((task) => {
        const statusMatch = status === "all" ? true : task.status === status;
        const priorityMatch = priority === "all" ? true : task.priority === priority;
        const projectMatch = projectFilter === "all" ? true : task.projectId === projectFilter;
        const searchMatch =
          searchQuery === ""
            ? true
            : task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
        return statusMatch && priorityMatch && projectMatch && searchMatch;
      }),
    [mergedTasks, priority, projectFilter, searchQuery, status]
  );

  const toggleTask = (taskId: string) => {
    setSelectedIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId]
    );
  };

  const handleRetry = () => {
    void Promise.all([mutateProjects(), mutateTasks()]);
  };

  return (
    <TasksPageView
      canManageTasks={canManageTasks}
      dependencyTaskId={dependencyTaskId}
      error={error}
      filteredTasks={filteredTasks}
      isLoading={isLoading}
      mergedTasks={mergedTasks}
      mutateTasks={mutateTasks}
      onRetry={handleRetry}
      priority={priority}
      projectFilter={projectFilter}
      projects={projects}
      projectsError={projectsError}
      projectsLoading={projectsLoading}
      searchQuery={searchQuery}
      selectedIds={selectedIds}
      setDependencyTaskId={setDependencyTaskId}
      setPriority={setPriority}
      setProjectFilter={setProjectFilter}
      setSearchQuery={setSearchQuery}
      setStatus={setStatus}
      setTaskModalOpen={setTaskModalOpen}
      status={status}
      taskModalOpen={taskModalOpen}
      toggleTask={toggleTask}
      updateTaskStatus={updateTaskStatus}
    />
  );
}
