"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  BriefcaseBusiness,
  Clock3,
  FileText,
  FolderKanban,
  ListTodo,
  MapPinned,
  Users2,
  Plus,
  Target,
} from "lucide-react";

import { useDashboard } from "@/components/dashboard-provider";
import { FieldMapCanvas } from "@/components/field-operations/field-map-canvas";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { ProjectCard } from "@/components/projects/project-card";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ClientChart } from "@/components/ui/client-chart";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChartSkeleton, KpiCardSkeleton, ProjectCardSkeleton } from "@/components/ui/skeleton";
import { DataErrorState } from "@/components/ui/data-error-state";
import { useLocale } from "@/contexts/locale-context";
import { buildFieldMapMarkers } from "@/lib/field-operations/location-catalog";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { Project } from "@/lib/types";
import { leadingLabel, safePercent } from "@/lib/utils";
import { DashboardSkeleton } from "@/components/ui/loading-skeleton";

const DashboardTrendChart = dynamic(
  () => import("@/components/dashboard/dashboard-trend-chart").then((module) => module.DashboardTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const DashboardBudgetChart = dynamic(
  () => import("@/components/dashboard/dashboard-budget-chart").then((module) => module.DashboardBudgetChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const DashboardRiskChart = dynamic(
  () => import("@/components/dashboard/dashboard-risk-chart").then((module) => module.DashboardRiskChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

function buildPortfolioTrend(
  projects: Project[],
  formatDateLocalized: (date: string, pattern?: string) => string
) {
  if (!projects.length) return [];

  const longestHistory = Math.max(...projects.map((project) => project.history.length));
  return Array.from({ length: longestHistory }, (_, index) => {
    const points = projects.map((project) => project.history[index]).filter(Boolean);

    return {
      name: points[0]?.date ? formatDateLocalized(points[0].date) : `P${index + 1}`,
      progress: Math.round(points.reduce((sum, point) => sum + point.progress, 0) / Math.max(points.length, 1)),
      actual: Math.round(points.reduce((sum, point) => sum + point.budgetActual, 0) / 1000),
      planned: Math.round(points.reduce((sum, point) => sum + point.budgetPlanned, 0) / 1000),
    };
  });
}

export function DashboardHome() {
  const { enumLabel, formatDateLocalized, locale, t } = useLocale();
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
  const [directionFilter, setDirectionFilter] = useState<"all" | Project["direction"]>("all");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);

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
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <KpiCardSkeleton key={index} />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Card className="p-3">
            <div className="grid gap-2 grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <ProjectCardSkeleton key={index} />
              ))}
            </div>
          </Card>
          <div className="grid gap-3">
            <Card className="p-3" data-testid="dashboard-goals">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-[var(--brand)]" />
                    <h3 className="text-xs font-medium">Цели и фокус</h3>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Темы, которые объединяют проекты и подсказывают управленческий курс.</p>
                </div>
                <Badge variant="neutral">…</Badge>
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="rounded-lg border bg-[var(--panel-soft)]/40 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-3 w-32 rounded-full bg-[var(--line)]/70" />
                      <div className="h-5 w-10 rounded-full bg-[var(--line)]/70" />
                    </div>
                    <div className="mt-2 h-2 w-24 rounded-full bg-[var(--line)]/60" />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground">Подтягиваем цели из проектов</p>
                <Link className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs" })} href="/goals">
                  Цели
                  <ArrowUpRight className="ml-auto h-3 w-3" />
                </Link>
              </div>
            </Card>
            <Card className="p-3">
              <ChartSkeleton className="h-48" />
            </Card>
          </div>
        </div>
      </div>
    );
  }

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

        <Card className="p-3" data-testid="dashboard-map">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
            <div className="min-w-0">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <MapPinned className="h-4 w-4 text-[var(--brand)]" />
                    <h3 className="text-xs font-medium">{t("dashboard.map")}</h3>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t("dashboard.mapDescription")}</p>
                </div>
                <Badge variant="neutral">{locationSummary.length} локаций</Badge>
              </div>

              {dashboardFieldMarkers.length > 0 ? (
                <div className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)] p-2">
                  <FieldMapCanvas
                    initialCenter={dashboardFieldCenter}
                    markers={dashboardFieldMarkers}
                  />
                </div>
              ) : (
                <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-3 text-sm text-muted-foreground">
                  Добавьте локации в проекты, чтобы карта показала точки работ.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Локации</p>
                <span className="text-[10px] text-muted-foreground">
                  {projects.filter((project) => Boolean(project.location)).length} проектов с локациями
                </span>
              </div>
              {locationSummary.length === 0 ? (
                <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-3 text-xs text-muted-foreground">
                  Локации появятся, когда проекты получат город или площадку.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {locationSummary.slice(0, 4).map((entry) => (
                    <div key={entry.location} className="rounded-lg border bg-[var(--panel-soft)]/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium leading-5 truncate">{entry.location}</p>
                        <Badge variant="neutral">{entry.count}</Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">Точки проектов на карте</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs" })}
                  href="/field-operations"
                >
                  {t("dashboard.mapOpen")}
                  <ArrowUpRight className="ml-auto h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </Card>

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

        {/* Right Sidebar */}
        <div className="grid gap-3">
          <Card className="p-3" data-testid="dashboard-goals">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-[var(--brand)]" />
                  <h3 className="text-xs font-medium">Цели и фокус</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">Темы, которые объединяют проекты и подсказывают управленческий курс.</p>
              </div>
              <Badge variant="neutral">{objectiveSummary.coveragePercent}%</Badge>
            </div>

            {topObjectiveThemes.length === 0 ? (
              <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-2 text-xs text-muted-foreground">
                Добавьте цели в проекты, чтобы здесь появился управленческий фокус.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                {topObjectiveThemes.map((theme) => (
                  <div key={theme.objective} className="rounded-lg border bg-[var(--panel-soft)]/40 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-5 line-clamp-2">{theme.objective}</p>
                      <Badge variant="neutral">{theme.count}×</Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {theme.projectCount} проектов · {theme.projectNames.slice(0, 2).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                {objectiveSummary.coveredProjects} из {objectiveSummary.totalProjects} проектов с целями
              </p>
              <Link
                className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs" })}
                href="/goals"
              >
                Цели
                <ArrowUpRight className="ml-auto h-3 w-3" />
              </Link>
            </div>
          </Card>

          {/* Critical Events */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium">{t("dashboard.criticalFeed")}</h3>
                <span className="text-[10px] text-muted-foreground">{notifications.length} событий</span>
              </div>
              <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                {notifications.map((notification) => (
                  <Link
                    key={notification.id}
                    className="block p-2 rounded border bg-[var(--panel-soft)]/40 hover:bg-[var(--panel-soft)]/60"
                    href={notification.projectId ? `/projects/${notification.projectId}` : "/"}
                  >
                    <p className="text-xs font-medium truncate">{notification.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{notification.description}</p>
                  </Link>
                ))}
              </div>
            </Card>

            {/* Team Load */}
            <Card className="p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium">{t("dashboard.teamLoad")}</h3>
                <span className="text-[10px] text-muted-foreground">{team.length} {t("dashboard.teamMembers")}</span>
              </div>
              {team.length === 0 ? (
                <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
                  {t("dashboard.noTeamMembers")}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                  {team.map((member) => {
                    const loadLevel = member.allocated >= 90 ? "critical" : member.allocated >= 70 ? "warning" : "normal";
                    return (
                      <div key={member.id} className="flex items-center gap-2 p-2 rounded border bg-[var(--panel-soft)]/40 hover:bg-[var(--panel-soft)]/60 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium truncate">{member.name}</p>
                            <span className={cn(
                              "text-[10px] font-medium",
                              loadLevel === "critical" && "text-rose-500",
                              loadLevel === "warning" && "text-amber-500",
                              loadLevel === "normal" && "text-muted-foreground"
                            )}>
                              {member.allocated}%
                            </span>
                          </div>
                          <div className="mt-1">
                            <div className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  loadLevel === "critical" && "bg-rose-500",
                                  loadLevel === "warning" && "bg-amber-500",
                                  loadLevel === "normal" && "bg-[var(--brand)]"
                                )}
                                style={{ width: `${member.allocated}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Risk Mix */}
            <Card className="p-3">
              <h3 className="text-xs font-medium mb-2">{t("dashboard.riskMix")}</h3>
              <div className="flex flex-col gap-3">
                <div className="h-[140px] w-full">
                  <DashboardRiskChart data={riskData} />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {riskData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 p-1.5 rounded border bg-[var(--panel-soft)]/40">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-[10px] flex-1 truncate">{entry.name}</span>
                      <span className="text-xs font-bold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Quick Actions */}
            <Card className="p-3">
              <h3 className="text-xs font-medium mb-2">{t("dashboard.quickActions")}</h3>
              <div className="grid gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setTaskModalOpen(true)} className="h-8 text-xs justify-start">
                  <Plus className="h-3 w-3 mr-2" />
                  {t("action.addTask")}
                </Button>
                <Link className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs justify-start" })} href="/portfolio">
                  {t("action.openPortfolio")}
                  <ArrowUpRight className="h-3 w-3 ml-auto" />
                </Link>
                <Link className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs justify-start" })} href="/analytics">
                  {t("nav.analytics")}
                  <ArrowUpRight className="h-3 w-3 ml-auto" />
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <ProjectFormModal open={projectModalOpen} onOpenChange={setProjectModalOpen} />
      <ProjectFormModal
        open={Boolean(editingProject)}
        onOpenChange={(open) => { if (!open) setEditingProject(null); }}
        project={editingProject}
      />
      <TaskFormModal open={taskModalOpen} onOpenChange={setTaskModalOpen} />
    </>
  );
}
