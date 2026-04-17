"use client";

import dynamic from "next/dynamic";
import type { Dispatch, SetStateAction } from "react";

import { ProjectAssistantDialog } from "@/components/ai/project-assistant-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { DataErrorState } from "@/components/ui/data-error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { fieldStyles } from "@/components/ui/field";
import { ChartSkeleton, ProjectCardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { useAIContext } from "@/lib/ai/context-provider";
import type { Project, Task } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

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

interface ProjectsPageViewProps {
  assistantOpen: boolean;
  assistantProject: Project | null;
  canManageProjects: boolean;
  direction: "all" | Project["direction"];
  duplicateProject: (projectId: string) => void;
  editingProject: Project | null;
  error: unknown;
  filteredProjects: Project[];
  isLoading: boolean;
  projectModalOpen: boolean;
  projects: Project[];
  query: string;
  setAssistantOpen: Dispatch<SetStateAction<boolean>>;
  setAssistantProject: Dispatch<SetStateAction<Project | null>>;
  setDirection: Dispatch<SetStateAction<"all" | Project["direction"]>>;
  setEditingProject: Dispatch<SetStateAction<Project | null>>;
  setProjectModalOpen: Dispatch<SetStateAction<boolean>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSortBy: Dispatch<SetStateAction<"progress" | "date" | "budget">>;
  setStatusFilter: Dispatch<SetStateAction<"all" | Project["status"]>>;
  sortBy: "progress" | "date" | "budget";
  statusFilter: "all" | Project["status"];
  tasks: Task[];
  tasksError: unknown;
  tasksLoading: boolean;
  onRetry: () => void;
}

export function ProjectsPageView({
  assistantOpen,
  assistantProject,
  canManageProjects,
  direction,
  duplicateProject,
  editingProject,
  error,
  filteredProjects,
  isLoading,
  projectModalOpen,
  projects,
  query,
  setAssistantOpen,
  setAssistantProject,
  setDirection,
  setEditingProject,
  setProjectModalOpen,
  setQuery,
  setSortBy,
  setStatusFilter,
  sortBy,
  statusFilter,
  tasks,
  tasksError,
  tasksLoading,
  onRetry,
}: ProjectsPageViewProps) {
  const { enumLabel, locale, t } = useLocale();
  const { features } = useAIContext();

  const totalBudget = filteredProjects.reduce((sum, project) => sum + project.budget.planned, 0);
  const totalActual = filteredProjects.reduce((sum, project) => sum + project.budget.actual, 0);
  const avgProgress = filteredProjects.length
    ? Math.round(filteredProjects.reduce((sum, project) => sum + project.progress, 0) / filteredProjects.length)
    : 0;
  const atRiskCount = filteredProjects.filter((project) => project.status === "at-risk").length;
  const compareData = filteredProjects.map((project) => ({
    name: project.name.slice(0, 12),
    progress: project.progress,
    health: project.health,
    budget: Math.round((project.budget.actual / project.budget.planned) * 100),
  }));
  const hasProjectFilters = query.trim().length > 0 || direction !== "all" || statusFilter !== "all";
  const clearFiltersLabel =
    locale === "ru" ? "Очистить фильтры" : locale === "zh" ? "清除筛选" : "Clear filters";
  const showHydrationSkeleton =
    isLoading && tasksLoading && projects.length === 0 && tasks.length === 0;

  if (showHydrationSkeleton) {
    return (
      <div className="grid min-w-0 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <ProjectCardSkeleton key={index} />
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
        onRetry={onRetry}
        title={t("error.loadTitle")}
      />
    );
  }

  return (
    <>
      <div className="grid min-w-0 gap-3" data-testid="projects-page">
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {isLoading || tasksLoading
            ? "Загрузка проектов..."
            : "Загружено " + filteredProjects.length + " проектов из " + projects.length}
        </div>

        <Card className="app-page-intro-card overflow-hidden" data-testid="projects-filters">
          <CardContent className="relative grid gap-4 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  Портфель проектов
                </p>
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)] sm:text-3xl">
                    {t("projects.portfolioView")}
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                    Здесь должен быть быстрый управленческий срез: какие проекты идут ровно, какие проседают и
                    где портфель уже расходится с ожиданиями по бюджету и прогрессу.
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <Button
                  className="h-10 w-full sm:w-auto"
                  data-testid="create-project-button"
                  disabled={!canManageProjects}
                  onClick={() => setProjectModalOpen(true)}
                  size="sm"
                >
                  {t("action.addProject")}
                </Button>
                <p className="text-xs text-[var(--ink-muted)]">
                  {filteredProjects.length} из {projects.length} проектов в текущем срезе
                </p>
              </div>
            </div>

            <div className="grid gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <input
                className={cn(fieldStyles, "h-10 w-full text-sm !py-1.5 leading-normal")}
                data-testid="projects-search-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("placeholder.search")}
                value={query}
              />
              <select
                className={cn(fieldStyles, "h-10 w-full px-3 text-sm !py-1.5 leading-normal")}
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
                className={cn(fieldStyles, "h-10 w-full px-3 text-sm !py-1.5 leading-normal")}
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
                className={cn(fieldStyles, "h-10 w-full px-3 text-sm !py-1.5 leading-normal")}
                data-testid="projects-sort-select"
                onChange={(event) => setSortBy(event.target.value as "progress" | "date" | "budget")}
                value={sortBy}
              >
                <option value="progress">По прогрессу</option>
                <option value="date">По дате</option>
                <option value="budget">По бюджету</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="projects-summary">
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

        {filteredProjects.length === 0 ? (
          <EmptyState
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {hasProjectFilters ? (
                  <Button
                    onClick={() => {
                      setQuery("");
                      setDirection("all");
                      setStatusFilter("all");
                    }}
                    variant="secondary"
                  >
                    {clearFiltersLabel}
                  </Button>
                ) : null}
                <Button disabled={!canManageProjects} onClick={() => setProjectModalOpen(true)}>
                  {t("action.addProject")}
                </Button>
              </div>
            }
            className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60"
            data-testid="projects-empty-state"
            description={
              hasProjectFilters
                ? locale === "ru"
                  ? "Попробуйте убрать часть фильтров или начать новый проект."
                  : locale === "zh"
                    ? "尝试清除部分筛选条件，或创建一个新项目。"
                    : "Try clearing some filters or start a new project."
                : locale === "ru"
                  ? "Создайте первый проект, чтобы портфель появился в этой области."
                  : locale === "zh"
                    ? "创建第一个项目，让这里出现您的项目组合。"
                    : "Create your first project to populate this area."
            }
            title={
              hasProjectFilters
                ? locale === "ru"
                  ? "Ничего не найдено"
                  : locale === "zh"
                    ? "没有找到项目"
                    : "No projects found"
                : locale === "ru"
                  ? "Пока нет проектов"
                  : locale === "zh"
                    ? "暂无项目"
                    : "No projects yet"
            }
            type="projects"
          />
        ) : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_320px]">
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              data-testid="projects-grid"
            >
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  onAskAI={
                    features.projectAssistant
                      ? (nextProject) => {
                          setAssistantProject(nextProject);
                          setAssistantOpen(true);
                        }
                      : undefined
                  }
                  onDuplicate={duplicateProject}
                  onEdit={setEditingProject}
                  project={project}
                  taskCount={tasks.filter((task) => task.projectId === project.id && task.status !== "done").length}
                />
              ))}
            </div>

            <Card className="h-fit bg-[var(--surface-panel)] p-4" data-testid="projects-comparison-panel">
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">{t("projects.comparison")}</h3>
              <ClientChart className="mb-3 h-[180px]">
                <ProjectsComparisonChart data={compareData} />
              </ClientChart>
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
                    <Badge className="text-xs" variant={project.status === "at-risk" ? "danger" : "success"}>
                      {project.health}%
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      <ProjectFormModal onOpenChange={setProjectModalOpen} open={canManageProjects && projectModalOpen} />
      <ProjectFormModal
        onOpenChange={(open) => {
          if (!open) {
            setEditingProject(null);
          }
        }}
        open={canManageProjects && Boolean(editingProject)}
        project={editingProject}
      />
      <ProjectAssistantDialog
        onOpenChange={(open) => {
          setAssistantOpen(open);
          if (!open) {
            setAssistantProject(null);
          }
        }}
        open={assistantOpen}
        project={assistantProject}
      />
    </>
  );
}
