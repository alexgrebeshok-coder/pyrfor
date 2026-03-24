"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Users,
  CheckCircle2,
  AlertCircle,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalyticsOverview } from "@/lib/hooks/use-analytics-overview";
import { useAnalyticsTeamPerformance } from "@/lib/hooks/use-analytics-team-performance";
const statusColors: Record<string, string> = {
  healthy: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  at_risk: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const statusLabels: Record<string, string> = {
  healthy: "Здоров",
  at_risk: "Под угрозой",
  critical: "Критичен",
};

export const AnalyticsDashboard = React.memo(function AnalyticsDashboard() {
  const {
    data: overviewData,
    error: overviewError,
    isLoading: overviewLoading,
    refresh: refreshOverview,
  } = useAnalyticsOverview();
  const {
    data: teamPerformanceData,
    error: teamError,
    isLoading: teamLoading,
    refresh: refreshTeam,
  } = useAnalyticsTeamPerformance();

  const isLoading = overviewLoading || teamLoading;
  const error = overviewError ?? teamError;
  const summary = overviewData?.summary ?? null;
  const projects = useMemo(() => overviewData?.projects ?? [], [overviewData?.projects]);
  const teamMembers = useMemo(
    () => teamPerformanceData?.members ?? [],
    [teamPerformanceData?.members]
  );
  const [activeTab, setActiveTab] = useState<"overview" | "team">("overview");

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => a.healthScore - b.healthScore);
  }, [projects]);

  const topPerformers = useMemo(() => {
    return teamMembers.slice(0, 5);
  }, [teamMembers]);

  const handleRefresh = useCallback(() => {
    refreshOverview?.();
    refreshTeam?.();
  }, [refreshOverview, refreshTeam]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-3">
              <div className="h-16 animate-pulse rounded bg-[var(--surface-secondary)]" />
            </Card>
          ))}
        </div>
        <Card className="p-3">
          <div className="h-48 animate-pulse rounded bg-[var(--surface-secondary)]" />
        </Card>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <Card className="p-3">
        <p className="text-center text-[var(--ink-muted)]">
          {error instanceof Error ? error.message : "Не удалось загрузить аналитику"}
        </p>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={handleRefresh} size="sm" className="gap-2">
            <Activity className="mr-2 h-4 w-4" />
            Попробовать снова
          </Button>
        </div>
      </Card>
    );
  }

  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.completedTasks / summary.totalTasks) * 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.04em]">Аналитика</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          className="h-8 transition-all duration-200 hover:scale-105"
        >
          <Activity className="mr-2 h-4 w-4" />
          Обновить
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card className="group p-3 transition-all duration-200 hover:shadow-md hover:scale-[1.01]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900">
              <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--ink-muted)]">Проекты</p>
              <p className="text-lg font-semibold tracking-[-0.05em]">
                {summary.activeProjects}/{summary.totalProjects}
              </p>
            </div>
          </div>
        </Card>

        <Card className="group p-3 transition-all duration-200 hover:shadow-md hover:scale-[1.01]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--ink-muted)]">Задачи</p>
              <p className="text-lg font-semibold tracking-[-0.05em]">{completionRate}%</p>
            </div>
          </div>
        </Card>

        <Card className="group p-3 transition-all duration-200 hover:shadow-md hover:scale-[1.01]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--ink-muted)]">Просрочено</p>
              <p className="text-lg font-semibold tracking-[-0.05em]">{summary.overdueTasks}</p>
            </div>
          </div>
        </Card>

        <Card className="group p-3 transition-all duration-200 hover:shadow-md hover:scale-[1.01]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900">
              <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--ink-muted)]">Команда</p>
              <p className="text-lg font-semibold tracking-[-0.05em]">{summary.teamSize}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--line)] overflow-x-auto">
        <button
          onClick={() => setActiveTab("overview")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-all duration-200",
            activeTab === "overview"
              ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
          )}
        >
          Обзор проектов
        </button>
        <button
          onClick={() => setActiveTab("team")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-all duration-200",
            activeTab === "team"
              ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
          )}
        >
          Команда
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <Card className="p-3">
          <h3 className="mb-3 text-base font-semibold">Здоровье проектов</h3>
          <div className="space-y-2.5">
            {sortedProjects.length === 0 ? (
              <p className="py-6 text-center text-[var(--ink-muted)]">
                Нет активных проектов
              </p>
            ) : (
              sortedProjects.map((project) => (
                <div
                  key={project.projectId}
                  className="flex items-center justify-between rounded-lg border border-[var(--line)] p-3 transition-all duration-200 hover:shadow-sm"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="text-sm font-medium">{project.projectName}</h4>
                      <Badge className={cn("text-[10px]", statusColors[project.status])}>
                        {statusLabels[project.status]}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--ink-muted)]">
                      <span>Прогресс: {project.progress}%</span>
                      {project.overdueTasks > 0 && (
                        <span className="text-red-500">
                          Просрочено: {project.overdueTasks}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold tracking-[-0.05em]">
                      {project.healthScore}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)]">Health</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {activeTab === "team" && (
        <Card className="p-3">
          <h3 className="mb-3 text-base font-semibold">Топ исполнители</h3>
          <div className="space-y-2.5">
            {topPerformers.length === 0 ? (
              <p className="py-6 text-center text-[var(--ink-muted)]">
                Нет данных по команде
              </p>
            ) : (
              topPerformers.map((member, index) => (
                <div
                  key={member.memberId}
                  className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-3 transition-all duration-200 hover:shadow-sm"
                >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-medium">{member.memberName}</h4>
                      <div className="text-xs text-[var(--ink-muted)]">
                        {member.metrics.completedTasks}/{member.metrics.totalTasks} задач
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.performanceScore >= 70 ? (
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm font-semibold">{member.performanceScore}%</span>
                    </div>
                  </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
});
