"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { useDashboard } from "@/components/dashboard-provider";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { ClientChart } from "@/components/ui/client-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { fieldStyles } from "@/components/ui/field";
import { ChartSkeleton, ProjectCardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { useProjects, useTasks } from "@/lib/hooks/use-api";
import { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const ProjectsComparisonChart = dynamic(
  () =>
    import("@/components/projects/projects-comparison-chart").then(
      (module) => module.ProjectsComparisonChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function ProjectsPage({ initialQuery = "" }: { initialQuery?: string }) {
  const { enumLabel, locale, t } = useLocale();
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

  const filteredProjects = useMemo(
    () => {
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

      // Sort
      return filtered.sort((a, b) => {
        if (sortBy === "progress") return b.progress - a.progress;
        if (sortBy === "date") return new Date(b.dates.start).getTime() - new Date(a.dates.start).getTime();
        if (sortBy === "budget") return b.budget.planned - a.budget.planned;
        return 0;
      });
    },
    [direction, projects, query, statusFilter, sortBy]
  );

  // Stats
  const totalBudget = filteredProjects.reduce((sum, p) => sum + p.budget.planned, 0);
  const totalActual = filteredProjects.reduce((sum, p) => sum + p.budget.actual, 0);
  const avgProgress = filteredProjects.length > 0 
    ? Math.round(filteredProjects.reduce((sum, p) => sum + p.progress, 0) / filteredProjects.length)
    : 0;
  const atRiskCount = filteredProjects.filter(p => p.status === "at-risk").length;

  const compareData = filteredProjects.map((project) => ({
    name: project.name.slice(0, 12),
    progress: project.progress,
    health: project.health,
    budget: Math.round((project.budget.actual / project.budget.planned) * 100),
  }));
  const hasProjectFilters =
    query.trim().length > 0 || direction !== "all" || statusFilter !== "all";
  const clearFiltersLabel =
    locale === "ru" ? "Очистить фильтры" : locale === "zh" ? "清除筛选" : "Clear filters";

  const showHydrationSkeleton =
    isLoading && tasksLoading && projects.length === 0 && tasks.length === 0;

  const handleRetry = () => {
    void Promise.all([mutateProjects(), mutateTasks()]);
  };

  if (showHydrationSkeleton) {
    return (
      <div className="grid min-w-0 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
          <Card>
            <CardContent className="p-4">
              <ChartSkeleton className="h-[300px]" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if ((error || tasksError) && projects.length === 0 && tasks.length === 0) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={
          error instanceof Error
            ? error.message
            : tasksError instanceof Error
              ? tasksError.message
              : t("error.loadDescription")
        }
        onRetry={handleRetry}
        title={t("error.loadTitle")}
      />
    );
  }

  return (
    <>
      <div className="grid min-w-0 gap-3" data-testid="projects-page">
        {/* Live region for screen readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {isLoading || tasksLoading
            ? "Загрузка проектов..."
            : `Загружено ${filteredProjects.length} проектов из ${projects.length}`}
        </div>

        {/* Header with filters */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid min-w-0 flex-1 gap-3" data-testid="projects-filters">
            <div>
              <h1 className="text-lg font-semibold text-[var(--ink)]">{t("projects.portfolioView")}</h1>
              <p className="text-xs text-[var(--ink-soft)]">{filteredProjects.length} проектов</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <input
                className={cn(fieldStyles, "h-10 w-full text-sm !py-1.5 leading-normal")}
                data-testid="projects-search-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("placeholder.search")}
                value={query}
              />
              <select
                className={cn(fieldStyles, "h-10 w-full text-sm !py-1.5 px-3 leading-normal")}
                data-testid="projects-direction-filter"
                onChange={(event) => setDirection(event.target.value as "all" | Project["direction"])}
                value={direction}
              >
                <option value="all">{t("filters.allDirections")}</option>
                {(["metallurgy", "logistics", "trade", "construction"] as const).map((value) => (
                  <option key={value} value={value}>
                    {enumLabel("direction", value)}
                  </option>
                ))}
              </select>
              <select
                className={cn(fieldStyles, "h-10 w-full text-sm !py-1.5 px-3 leading-normal")}
                data-testid="projects-status-filter"
                onChange={(event) => setStatusFilter(event.target.value as "all" | Project["status"])}
                value={statusFilter}
              >
                <option value="all">{t("filters.allStatuses")}</option>
                {(["active", "on-hold", "completed", "at-risk"] as const).map((value) => (
                  <option key={value} value={value}>
                    {enumLabel("projectStatus", value)}
                  </option>
                ))}
              </select>
              <select
                className={cn(fieldStyles, "h-10 w-full text-sm !py-1.5 px-3 leading-normal")}
                data-testid="projects-sort-select"
                onChange={(event) => setSortBy(event.target.value as "progress" | "date" | "budget")}
                value={sortBy}
              >
                <option value="progress">По прогрессу</option>
                <option value="date">По дате</option>
                <option value="budget">По бюджету</option>
              </select>
            </div>
          </div>
          <Button
            size="sm"
            className="h-10 w-full sm:w-auto"
            data-testid="create-project-button"
            onClick={() => setProjectModalOpen(true)}
          >
            {t("action.addProject")}
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4" data-testid="projects-summary">
          <Card className="p-2">
            <div className="text-[10px] text-[var(--ink-soft)]">{t("dashboard.kpi.budgetUsed")}</div>
            <div className="text-sm font-semibold text-[var(--ink)]">{formatCurrency(totalBudget, "RUB")}</div>
          </Card>
          <Card className="p-2">
            <div className="text-[10px] text-[var(--ink-soft)]">{t("dashboard.evm.budget")}</div>
            <div className="text-sm font-semibold text-[var(--ink)]">{formatCurrency(totalActual, "RUB")}</div>
          </Card>
          <Card className="p-2">
            <div className="text-[10px] text-[var(--ink-soft)]">{t("project.progressLabel")}</div>
            <div className="text-sm font-semibold text-[var(--ink)]">{avgProgress}%</div>
          </Card>
          <Card className="p-2">
            <div className="text-[10px] text-[var(--ink-soft)]">{t("dashboard.atRisk")}</div>
            <div className={cn("text-sm font-semibold", atRiskCount > 0 ? "text-red-500" : "text-[var(--ink)]")}>
              {atRiskCount}
            </div>
          </Card>
        </div>

        {/* Projects grid + sidebar */}
        {filteredProjects.length === 0 ? (
          <Card
            className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-4"
            data-testid="projects-empty-state"
          >
            <div className="grid gap-3 text-center">
              <div className="grid gap-1">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  {hasProjectFilters
                    ? locale === "ru"
                      ? "Ничего не найдено"
                      : locale === "zh"
                        ? "没有找到项目"
                        : "No projects found"
                    : locale === "ru"
                      ? "Пока нет проектов"
                      : locale === "zh"
                        ? "暂无项目"
                        : "No projects yet"}
                </h2>
                <p className="mx-auto max-w-xl text-sm text-[var(--ink-soft)]">
                  {hasProjectFilters
                    ? locale === "ru"
                      ? "Попробуйте убрать часть фильтров или начать новый проект."
                      : locale === "zh"
                        ? "尝试清除部分筛选条件，或创建一个新项目。"
                        : "Try clearing some filters or start a new project."
                    : locale === "ru"
                      ? "Создайте первый проект, чтобы портфель появился в этой области."
                      : locale === "zh"
                        ? "创建第一个项目，让这里出现您的项目组合。"
                        : "Create your first project to populate this area."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {hasProjectFilters ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setDirection("all");
                      setStatusFilter("all");
                    }}
                  >
                    {clearFiltersLabel}
                  </Button>
                ) : null}
                <Button onClick={() => setProjectModalOpen(true)}>{t("action.addProject")}</Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_320px]">
            {/* Projects grid */}
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              data-testid="projects-grid"
            >
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  taskCount={
                    tasks.filter((task) => task.projectId === project.id && task.status !== "done").length
                  }
                  onDuplicate={duplicateProject}
                  onEdit={setEditingProject}
                />
              ))}
            </div>

            {/* Sidebar with chart */}
            <Card className="h-fit bg-[var(--surface-panel)] p-4" data-testid="projects-comparison-panel">
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">{t("projects.comparison")}</h3>
              <ClientChart className="mb-3 h-[180px]">
                <ProjectsComparisonChart data={compareData} />
              </ClientChart>

              {/* Mini list */}
              <div className="space-y-2">
                {filteredProjects.slice(0, 4).map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">{project.name}</p>
                      <p className="text-xs text-[var(--ink-soft)]">{project.progress}%</p>
                    </div>
                    <Badge
                      className="text-xs"
                      variant={project.status === "at-risk" ? "danger" : "success"}
                    >
                      {project.health}%
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      <ProjectFormModal
        open={projectModalOpen}
        onOpenChange={setProjectModalOpen}
      />
      <ProjectFormModal
        open={Boolean(editingProject)}
        onOpenChange={(open) => {
          if (!open) setEditingProject(null);
        }}
        project={editingProject}
      />
    </>
  );
}

// Helper
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
