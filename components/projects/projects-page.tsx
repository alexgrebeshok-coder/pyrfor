"use client";

import { useMemo, useState } from "react";

import { useDashboard } from "@/components/dashboard-provider";
import { ProjectsPageView } from "@/components/projects/projects-page-view";
import { useProjects, useTasks } from "@/lib/hooks/use-api";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type { Project } from "@/lib/types";

export function ProjectsPage({ initialQuery = "" }: { initialQuery?: string }) {
  const { allowed: canManageProjects } = usePlatformPermission("MANAGE_TASKS");
  const { duplicateProject } = useDashboard();
  const { error, isLoading, mutate: mutateProjects, projects } = useProjects();
  const {
    error: tasksError,
    isLoading: tasksLoading,
    mutate: mutateTasks,
    tasks,
  } = useTasks();
  const [query, setQuery] = useState(initialQuery);
  const [direction, setDirection] = useState<"all" | Project["direction"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Project["status"]>("all");
  const [sortBy, setSortBy] = useState<"progress" | "date" | "budget">("progress");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [assistantProject, setAssistantProject] = useState<Project | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((project) => {
      const queryMatch =
        query.trim().length === 0
          ? true
          : [project.name, project.description, project.location]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase());
      const directionMatch = direction === "all" ? true : project.direction === direction;
      const statusMatch = statusFilter === "all" ? true : project.status === statusFilter;
      return queryMatch && directionMatch && statusMatch;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "progress") return b.progress - a.progress;
      if (sortBy === "date") return new Date(b.dates.start).getTime() - new Date(a.dates.start).getTime();
      if (sortBy === "budget") return b.budget.planned - a.budget.planned;
      return 0;
    });
  }, [direction, projects, query, sortBy, statusFilter]);

  const handleRetry = () => {
    void Promise.all([mutateProjects(), mutateTasks()]);
  };

  return (
    <ProjectsPageView
      assistantOpen={assistantOpen}
      assistantProject={assistantProject}
      canManageProjects={canManageProjects}
      direction={direction}
      duplicateProject={duplicateProject}
      editingProject={editingProject}
      error={error}
      filteredProjects={filteredProjects}
      isLoading={isLoading}
      projectModalOpen={projectModalOpen}
      projects={projects}
      query={query}
      setAssistantOpen={setAssistantOpen}
      setAssistantProject={setAssistantProject}
      setDirection={setDirection}
      setEditingProject={setEditingProject}
      setProjectModalOpen={setProjectModalOpen}
      setQuery={setQuery}
      setSortBy={setSortBy}
      setStatusFilter={setStatusFilter}
      sortBy={sortBy}
      statusFilter={statusFilter}
      tasks={tasks}
      tasksError={tasksError}
      tasksLoading={tasksLoading}
      onRetry={handleRetry}
    />
  );
}
