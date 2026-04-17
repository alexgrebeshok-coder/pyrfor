"use client";

import dynamic from "next/dynamic";
import { useState, useMemo } from "react";
import { Plus } from "lucide-react";

import { ProjectAssistantDialog } from "@/components/ai/project-assistant-dialog";
import { DashboardHomeMapCard } from "@/components/dashboard/dashboard-home-map-card";
import { DashboardHomeSidebar } from "@/components/dashboard/dashboard-home-sidebar";
import { DashboardHomeSkeleton } from "@/components/dashboard/dashboard-home-skeleton";
import { useDashboard } from "@/components/dashboard-provider";
import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { DataErrorState } from "@/components/ui/data-error-state";
import { useLocale } from "@/contexts/locale-context";
import { useAIContext } from "@/lib/ai/context-provider";
import { buildFieldMapMarkers } from "@/lib/field-operations/location-catalog";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { Project } from "@/lib/types";
import { leadingLabel, safePercent } from "@/lib/utils";
import {
  buildLocationContours,
  buildPortfolioTrend,
} from "@/components/dashboard/dashboard-home-utils";

const DashboardTrendChart = dynamic(
  () => import("@/components/dashboard/dashboard-trend-chart").then((module) => module.DashboardTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const DashboardBudgetChart = dynamic(
  () => import("@/components/dashboard/dashboard-budget-chart").then((module) => module.DashboardBudgetChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const ProjectFormModal = dynamic(
  () =>
    import("@/components/projects/project-form-modal").then(
      (module) => module.ProjectFormModal
    ),
  {
    ssr: false,
  }
);

const TaskFormModal = dynamic(
  () =>
    import("@/components/tasks/task-form-modal").then(
      (module) => module.TaskFormModal
    ),
  {
    ssr: false,
  }
);

export function DashboardHome() {
  const { enumLabel, formatDateLocalized, locale, t } = useLocale();
  const { features, openAssistant, runPreset } = useAIContext();
  const {
    notifications,
    projects: providerProjects,
    risks: providerRisks,
    tasks: providerTasks,
    team: providerTeam,
    duplicateProject,
  } = useDashboard();
  
  const {
    error,
    isLoading,
    projects: snapshotProjects,
    retry,
    risks: snapshotRisks,
    tasks: snapshotTasks,
    team: snapshotTeam,
  } = useDashboardSnapshot();

  const [statusFilter, setStatusFilter] = useState<"all" | Project["status"]>("all");
  const [directionFilter] = useState<"all" | Project["direction"]>("all");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [assistantProject, setAssistantProject] = useState<Project | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const projects = snapshotProjects.length > 0 ? snapshotProjects : providerProjects;
  const tasks = snapshotTasks.length > 0 ? snapshotTasks : providerTasks;
  const team = snapshotTeam.length > 0 ? snapshotTeam : providerTeam;
  const risks = snapshotRisks.length > 0 ? snapshotRisks : providerRisks;
  const objectiveSummary = useMemo(() => summarizeObjectiveThemes(projects), [projects]);
  const topObjectiveThemes = objectiveSummary.themes.slice(0, 3);

  const hasFallbackData = projects.length > 0 || tasks.length > 0 || team.length > 0 || risks.length > 0;

  const filteredProjects = projects.filter((project) => {
    const statusMatch = statusFilter === "all" ? true : project.status === statusFilter;
    const directionMatch = directionFilter === "all" ? true : project.direction === directionFilter;
    return statusMatch && directionMatch;
  });

  // Stats
  const totalPlanned = projects.reduce((sum, project) => sum + project.budget.planned, 0);
  const totalActual = projects.reduce((sum, project) => sum + project.budget.actual, 0);
  const budgetUsed = safePercent(totalActual, totalPlanned);
  const totalTasks = tasks.length;
  const inProgressTasks = tasks.filter((task) => task.status === "in-progress").length;
  const openRiskCount = notifications.filter((notification) => notification.severity !== "info").length;
  const activeProjects = projects.filter((project) => project.status === "active").length;

  // Chart data
  const trendData = buildPortfolioTrend(projects, formatDateLocalized);
  const budgetData = projects.map((project) => ({
    name: leadingLabel(project.name),
    planned: Math.round(project.budget.planned / 100000),
    actual: Math.round(project.budget.actual / 100000),
  }));
  const riskData = [
    { name: enumLabel("severity", "critical"), value: notifications.filter((n) => n.severity === "critical").length, color: "#fb7185" },
    { name: enumLabel("severity", "warning"), value: notifications.filter((n) => n.severity === "warning").length, color: "#f59e0b" },
    { name: enumLabel("severity", "info"), value: notifications.filter((n) => n.severity === "info").length, color: "#38bdf8" },
  ];
  const locationSummary = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((project) => {
      if (!project.location) return;
      counts.set(project.location, (counts.get(project.location) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));
  }, [projects]);

  const locationContours = useMemo(
    () => buildLocationContours(projects, notifications),
    [notifications, projects]
  );

  const dashboardFieldMarkers = useMemo(
    () =>
      buildFieldMapMarkers({
        projects: projects
          .filter((project) => Boolean(project.location))
          .map((project) => ({
            id: project.id,
            name: project.name,
            location: project.location,
            status: project.status,
            progress: project.progress,
            health: project.health,
          })),
        geofences: [],
      }),
    [projects]
  );

  const dashboardFieldCenter = useMemo(() => {
    if (dashboardFieldMarkers.length === 0) {
      return { latitude: 61.5, longitude: 65.0, zoom: 2.6 };
    }

    const totalLatitude = dashboardFieldMarkers.reduce((sum, marker) => sum + marker.latitude, 0);
    const totalLongitude = dashboardFieldMarkers.reduce((sum, marker) => sum + marker.longitude, 0);
    return {
      latitude: totalLatitude / dashboardFieldMarkers.length,
      longitude: totalLongitude / dashboardFieldMarkers.length,
      zoom: dashboardFieldMarkers.length > 1 ? 2.9 : 4,
    };
  }, [dashboardFieldMarkers]);

  const showHydrationSkeleton = isLoading && projects.length === 0 && tasks.length === 0;

  if (showHydrationSkeleton) {
    return <DashboardHomeSkeleton t={t} />;
  }

  const launchPortfolioPreset = async (
    kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions"
  ) => {
    setAssistantProject(null);
    setAssistantOpen(true);
    const target = {
      id: null,
      name: t("ai.assistant.portfolioTitle"),
    };

    await openAssistant(target);
    await runPreset(kind, target);
  };

  if (error && !hasFallbackData) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={error instanceof Error ? error.message : t("error.loadDescription")}
        onRetry={retry}
        title={t("error.loadTitle")}
      />
    );
  }

  return (
    <>
      {/* Live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading
          ? t("accessibility.dashboardLoading")
          : t("accessibility.dashboardLoaded", { projects: projects.length, tasks: tasks.length, team: team.length })}
      </div>

      <div className="grid gap-3">
        {/* Compact KPI Row */}
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("dashboard.kpi.activeProjects")}</p>
            <p className="text-lg font-bold">{activeProjects}</p>
          </Card>
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("dashboard.kpi.objectiveCoverage")}</p>
            <p className={`text-lg font-bold ${objectiveSummary.coveragePercent >= 70 ? "text-green-600" : "text-amber-600"}`}>
              {objectiveSummary.coveragePercent}%
            </p>
          </Card>
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.total")}</p>
            <p className="text-lg font-bold">{totalTasks}</p>
          </Card>
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("tasks.inProgress")}</p>
            <p className="text-lg font-bold text-blue-600">{inProgressTasks}</p>
          </Card>
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("dashboard.criticalFeed")}</p>
            <p className={`text-lg font-bold ${openRiskCount > 0 ? "text-red-600" : "text-green-600"}`}>{openRiskCount}</p>
          </Card>
          <Card className="p-2">
            <p className="text-[10px] uppercase text-muted-foreground">{t("nav.team")}</p>
            <p className="text-lg font-bold">{team.length}</p>
          </Card>
        </div>

        <DashboardHomeMapCard
          dashboardFieldCenter={dashboardFieldCenter}
          dashboardFieldMarkers={dashboardFieldMarkers}
          locationContours={locationContours}
          locationSummaryCount={locationSummary.length}
          projectsWithLocationsCount={projects.filter((project) => Boolean(project.location)).length}
          t={t}
        />

        {/* Main Grid: Projects + Sidebar */}
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          {/* Left: Projects Grid + Charts */}
          <div className="grid gap-3">
            {/* Projects Grid */}
            <Card className="p-3">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">{t("dashboard.projectsGrid")} ({filteredProjects.length})</h2>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 text-xs border rounded px-2"
                    onChange={(e) => setStatusFilter(e.target.value as "all" | Project["status"])}
                    value={statusFilter}
                  >
                    <option value="all">{t("filters.allStatuses")}</option>
                    <option value="active">{enumLabel("projectStatus", "active")}</option>
                    <option value="planning">{enumLabel("projectStatus", "planning")}</option>
                    <option value="at-risk">{enumLabel("projectStatus", "at-risk")}</option>
                    <option value="completed">{enumLabel("projectStatus", "completed")}</option>
                  </select>
                  <Button size="sm" onClick={() => setProjectModalOpen(true)} className="h-8">
                    <Plus className="h-3 w-3 mr-1" />
                    {t("action.addProject")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.slice(0, 6).map((project) => (
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
            </Card>

            {/* Charts Grid */}
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">{t("dashboard.progressVsBudget")}</h3>
                <div className="h-[200px] w-full">
                  <DashboardTrendChart data={trendData} />
                </div>
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">{t("dashboard.budgetVariance")}</h3>
                <div className="h-[200px] w-full">
                  <DashboardBudgetChart data={budgetData} />
                </div>
              </Card>
            </div>

            {/* Budget Summary */}
            <Card className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("dashboard.kpi.budgetUsed")}</p>
                  <p className="text-lg font-bold">{totalActual.toLocaleString(locale === "zh" ? "zh-CN" : locale)} ₽</p>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={budgetUsed} className="w-32 h-2" />
                  <Badge variant={budgetUsed > 75 ? "warning" : "success"}>{budgetUsed}%</Badge>
                </div>
              </div>
            </Card>
          </div>

          <DashboardHomeSidebar
            features={features}
            launchPortfolioPreset={launchPortfolioPreset}
            notifications={notifications}
            objectiveSummary={objectiveSummary}
            onOpenTaskModal={() => setTaskModalOpen(true)}
            riskData={riskData}
            t={t}
            team={team}
            topObjectiveThemes={topObjectiveThemes}
          />
        </div>
      </div>

      {projectModalOpen ? (
        <ProjectFormModal open={projectModalOpen} onOpenChange={setProjectModalOpen} />
      ) : null}
      {editingProject ? (
        <ProjectFormModal
          open={Boolean(editingProject)}
          onOpenChange={(open) => {
            if (!open) setEditingProject(null);
          }}
          project={editingProject}
        />
      ) : null}
      {taskModalOpen ? (
        <TaskFormModal open={taskModalOpen} onOpenChange={setTaskModalOpen} />
      ) : null}
      <ProjectAssistantDialog
        open={assistantOpen}
        onOpenChange={(open) => {
          setAssistantOpen(open);
          if (!open) {
            setAssistantProject(null);
          }
        }}
        project={assistantProject}
      />
    </>
  );
}
