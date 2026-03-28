"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { subDays } from "date-fns";

import { useDashboard } from "@/components/dashboard-provider";
import { ClientChart } from "@/components/ui/client-chart";
import { Card } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { formatCurrency, leadingLabel } from "@/lib/utils";
import { ChartErrorBoundary } from "@/components/analytics/chart-error-boundary";

const AnalyticsTrendChart = dynamic(
  () =>
    import("@/components/analytics/analytics-trend-chart").then(
      (module) => module.AnalyticsTrendChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

const AnalyticsHealthChart = dynamic(
  () =>
    import("@/components/analytics/analytics-health-chart").then(
      (module) => module.AnalyticsHealthChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

const AnalyticsBudgetChart = dynamic(
  () =>
    import("@/components/analytics/analytics-budget-chart").then(
      (module) => module.AnalyticsBudgetChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function AnalyticsPage() {
  const { t } = useLocale();
  const { projects, team } = useDashboard();
  const [period, setPeriod] = useState("90d");
  const periodDays = period === "30d" ? 30 : period === "90d" ? 90 : 180;
  const periodCutoff = useMemo(() => subDays(new Date(), periodDays), [periodDays]);

  const periodSnapshots = useMemo(
    () =>
      projects.map((project) => {
        const historyWithinPeriod = project.history.filter(
          (point) => new Date(point.date).getTime() >= periodCutoff.getTime()
        );
        const latestPoint =
          historyWithinPeriod[historyWithinPeriod.length - 1] ??
          project.history[project.history.length - 1] ??
          {
            date: project.dates.start,
            progress: project.progress,
            budgetPlanned: project.budget.planned,
            budgetActual: project.budget.actual,
          };

        return { project, latestPoint };
      }),
    [periodCutoff, projects]
  );

  const timelineDates = useMemo(() => {
    const dates = new Set<string>();

    for (const project of projects) {
      for (const point of project.history) {
        if (new Date(point.date).getTime() >= periodCutoff.getTime()) {
          dates.add(point.date);
        }
      }
    }

    if (dates.size === 0) {
      for (const project of projects) {
        for (const point of project.history.slice(-4)) {
          dates.add(point.date);
        }
      }
    }

    return Array.from(dates).sort();
  }, [periodCutoff, projects]);

  const progressTrend = useMemo(() => {
    if (!projects.length || !timelineDates.length) return [];

    return timelineDates.map((date) => {
      const referenceTime = new Date(date).getTime();
      const snapshots = projects.map((project) => {
        const history = project.history.filter((point) => {
          const pointTime = new Date(point.date).getTime();
          return pointTime <= referenceTime && pointTime >= periodCutoff.getTime();
        });

        return (
          history[history.length - 1] ??
          project.history[project.history.length - 1] ??
          {
            date,
            progress: project.progress,
            budgetPlanned: project.budget.planned,
            budgetActual: project.budget.actual,
          }
        );
      });

      return {
        name: date.slice(5),
        progress: Math.round(
          snapshots.reduce((sum, snapshot) => sum + snapshot.progress, 0) / snapshots.length
        ),
        spend: Math.round(
          snapshots.reduce((sum, snapshot) => sum + snapshot.budgetActual, 0) / 1000
        ),
      };
    });
  }, [periodCutoff, projects, timelineDates]);

  const portfolioHealthData = useMemo(
    () =>
      periodSnapshots.map(({ project, latestPoint }) => ({
        name: leadingLabel(project.name),
        health: project.health,
        budgetVariance: Math.round(
          ((latestPoint.budgetActual - latestPoint.budgetPlanned) /
            Math.max(latestPoint.budgetPlanned, 1)) *
            100
        ),
      })),
    [periodSnapshots]
  );

  const healthMix = useMemo(
    () => [
      {
        name: t("analytics.mixHealthy"),
        value: periodSnapshots.filter(({ project }) => project.health >= 75).length,
        color: "#10b981",
      },
      {
        name: t("analytics.mixAttention"),
        value: periodSnapshots.filter(
          ({ project }) => project.health >= 60 && project.health < 75
        ).length,
        color: "#f59e0b",
      },
      {
        name: t("analytics.mixCritical"),
        value: periodSnapshots.filter(({ project }) => project.health < 60).length,
        color: "#fb7185",
      },
    ],
    [periodSnapshots, t]
  );

  const utilization = useMemo(
    () =>
      team.map((member) => ({
        name: member.name,
        allocated: member.allocated,
      })),
    [team]
  );
  const totalPlannedBudget = useMemo(
    () => projects.reduce((sum, project) => sum + project.budget.planned, 0),
    [projects]
  );
  const totalActualBudget = useMemo(
    () => projects.reduce((sum, project) => sum + project.budget.actual, 0),
    [projects]
  );
  const averageProgress = useMemo(
    () =>
      projects.length
        ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
        : 0,
    [projects]
  );
  const averageHealth = useMemo(
    () =>
      projects.length
        ? Math.round(projects.reduce((sum, project) => sum + project.health, 0) / projects.length)
        : 0,
    [projects]
  );

  return (
    <div className="grid gap-3" data-testid="analytics-page">
      {/* Header */}
      <Card className="app-page-intro-card p-3 sm:p-4" data-testid="analytics-header">
        <div className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Портфельная динамика
              </p>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-2xl">
                  {t("analytics.title")}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                  {t("analytics.description")} Показываем не просто графики, а текущий ритм исполнения,
                  расхождение по бюджету и общий уровень здоровья портфеля.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              <select
                className={`${fieldStyles} !py-1 h-10 w-full text-sm sm:w-auto`}
                data-testid="analytics-period-select"
                onChange={(event) => setPeriod(event.target.value)}
                value={period}
              >
                <option value="30d">{t("analytics.period30d")}</option>
                <option value="90d">{t("analytics.period90d")}</option>
                <option value="180d">{t("analytics.period180d")}</option>
              </select>
              <p className="text-xs text-[var(--ink-muted)]">История за последние {periodDays} дней</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Средний прогресс</p>
              <p className="mt-2 text-xl font-semibold text-[var(--ink)]">{averageProgress}%</p>
            </div>
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Среднее здоровье</p>
              <p className="mt-2 text-xl font-semibold text-[var(--ink)]">{averageHealth}%</p>
            </div>
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Плановый бюджет</p>
              <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
                {formatCurrency(totalPlannedBudget, "RUB")}
              </p>
            </div>
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Факт расходов</p>
              <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
                {formatCurrency(totalActualBudget, "RUB")}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Charts Grid 2x2 */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Trend Chart */}
        <Card className="p-3" data-testid="analytics-trend-card">
          <h3 className="text-xs font-medium mb-2">{t("analytics.trendline")}</h3>
          <ClientChart className="h-48">
            <ChartErrorBoundary>
              <AnalyticsTrendChart data={progressTrend} />
            </ChartErrorBoundary>
          </ClientChart>
        </Card>

        {/* Health Mix */}
        <Card className="p-3" data-testid="analytics-health-card">
          <h3 className="text-xs font-medium mb-2">{t("analytics.healthMix")}</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            <ClientChart className="h-36">
              <ChartErrorBoundary>
                <AnalyticsHealthChart data={healthMix} />
              </ChartErrorBoundary>
            </ClientChart>
            <div className="space-y-1.5">
              {healthMix.map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center justify-between p-2 rounded border bg-[var(--panel-soft)]/40"
                  data-testid="analytics-health-row"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-[10px]">{entry.name}</span>
                  </div>
                  <span className="text-sm font-bold">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Budget Variance */}
        <Card className="p-3" data-testid="analytics-budget-card">
          <h3 className="text-xs font-medium mb-2">{t("analytics.budgetVariance")}</h3>
          <ClientChart className="h-48">
            <ChartErrorBoundary>
              <AnalyticsBudgetChart data={portfolioHealthData} />
            </ChartErrorBoundary>
          </ClientChart>
        </Card>

        {/* Resource Utilization */}
        <Card className="p-3" data-testid="analytics-utilization-card">
          <h3 className="text-xs font-medium mb-2">{t("analytics.resourceUtilization")}</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {utilization.map((member) => (
              <div
                key={member.name}
                className="flex items-center gap-2 p-2 rounded border bg-[var(--panel-soft)]/40"
                data-testid="analytics-utilization-row"
              >
                <span className="text-xs flex-1 truncate">{member.name}</span>
                <span className="text-[10px] text-muted-foreground w-8 text-right">{member.allocated}%</span>
                <div className="w-16 h-1.5 rounded-full bg-[var(--panel-soft-strong)]">
                  <div
                    className="h-full rounded-full bg-[var(--brand)]"
                    style={{ width: `${member.allocated}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Financial Snapshot - Compact */}
      <Card className="p-3" data-testid="analytics-financial-snapshot">
        <h3 className="text-xs font-medium mb-2">{t("analytics.financialSnapshot")}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {projects.slice(0, 4).map((project) => (
            <div
              key={project.id}
              className="p-2 rounded border bg-[var(--panel-soft)]/40"
              data-testid="analytics-financial-item"
            >
              <p className="text-xs font-medium truncate">{project.name}</p>
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>{formatCurrency(project.budget.planned, project.budget.currency)}</span>
                <span className="text-[var(--ink-soft)]">
                  {formatCurrency(project.budget.actual, project.budget.currency)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
