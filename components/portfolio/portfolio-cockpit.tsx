"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { ComponentType } from "react";
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gauge,
  ShieldAlert,
  Sparkles,
  Target,
  Wallet,
  Users,
} from "lucide-react";

import { PortfolioHealthCard } from "@/components/analytics/portfolio-health-card";
import { TeamPerformanceLazy } from "@/components/analytics/team-performance-lazy";
import { useAnalyticsOverview } from "@/lib/hooks/use-analytics-overview";
import { useAnalyticsRecommendations } from "@/lib/hooks/use-analytics-recommendations";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { useRiskData } from "@/lib/hooks/use-risk-data";
import { useTeamCapacity } from "@/lib/hooks/use-team-capacity";
import {
  summarizePortfolioCapacityOutlook,
  summarizePortfolioFinanceOutlook,
  summarizePortfolioScenarioOutlook,
} from "@/lib/portfolio/portfolio-outlook";
import { calculatePortfolioHealth } from "@/lib/ai/health-calculator";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency, safePercent } from "@/lib/utils";
import type { AnalyticsRecommendation } from "@/lib/types/analytics";

const BudgetChart = dynamic(
  () =>
    import("@/components/analytics/budget-chart").then((module) => ({
      default: module.BudgetChart,
    })),
  {
    ssr: false,
    loading: () => <ChartSkeleton className="h-[420px]" />,
  }
);

const RiskMatrix = dynamic(
  () =>
    import("@/components/analytics/risk-matrix").then((module) => ({
      default: module.RiskMatrix,
    })),
  {
    ssr: false,
    loading: () => <ChartSkeleton className="h-[420px]" />,
  }
);

const ProjectTimeline = dynamic(
  () =>
    import("@/components/analytics/project-timeline").then((module) => ({
      default: module.ProjectTimeline,
    })),
  {
    ssr: false,
    loading: () => <ChartSkeleton className="h-[420px]" />,
  }
);

const toneClasses = {
  success:
    "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
  warning:
    "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  danger:
    "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30",
  info: "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
} as const;

function formatRatio(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(2);
}

function getCountVariant(count: number) {
  if (count === 0) return "success" as const;
  if (count <= 2) return "warning" as const;
  return "danger" as const;
}

function getPriorityVariant(priority: AnalyticsRecommendation["priority"]) {
  switch (priority) {
    case "critical":
      return "danger" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    case "low":
    default:
      return "neutral" as const;
  }
}

function getRecommendationTone(priority: AnalyticsRecommendation["priority"]) {
  switch (priority) {
    case "critical":
      return toneClasses.danger;
    case "high":
      return toneClasses.warning;
    case "medium":
      return toneClasses.info;
    case "low":
    default:
      return "border-[var(--line)] bg-[var(--panel-soft)]/60";
  }
}

export function PortfolioCockpitPage() {
  const { t, formatDateLocalized, locale } = useLocale();
  const {
    projects,
    risks: snapshotRisks,
    tasks,
    team,
    isLoading: snapshotLoading,
    error: snapshotError,
    retry,
  } = useDashboardSnapshot();
  const { data: overview, error: overviewError, isLoading: overviewLoading, refresh: refreshOverview } =
    useAnalyticsOverview();
  const {
    recommendations,
    summary: recommendationSummary,
    error: recommendationsError,
    isLoading: recommendationsLoading,
    refresh: refreshRecommendations,
  } = useAnalyticsRecommendations();
  const { data: budgetData, error: budgetError, isLoading: budgetLoading, refresh: refreshBudget } =
    useBudgetData();
  const { data: riskData, error: riskError, isLoading: riskLoading, refresh: refreshRisk } =
    useRiskData();
  const { rows: capacityRows, totals: capacityTotals, error: capacityError, isLoading: capacityLoading, refresh: refreshCapacity } =
    useTeamCapacity();

  const portfolioHealth = useMemo(() => {
    if (!projects.length) return null;

    const avgUtilization = team.length
      ? team.reduce((sum, member) => sum + (member.allocated ?? 0), 0) / team.length
      : 0;

    return calculatePortfolioHealth(projects, snapshotRisks, avgUtilization);
  }, [projects, snapshotRisks, team]);

  const planFact = overview?.summary.planFact;
  const totalPlan = budgetData.reduce((sum, item) => sum + item.planned, 0);
  const totalFact = budgetData.reduce((sum, item) => sum + item.actual, 0);
  const budgetUsed = safePercent(totalFact, totalPlan);
  const overdueTasks = overview?.summary.overdueTasks ?? tasks.filter((task) => {
    if (task.status === "done") return false;
    const dueDate = new Date(task.dueDate);
    return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now();
  }).length;
  const teamUtilization =
    team.length > 0
      ? Math.round(team.reduce((sum, member) => sum + (member.allocated ?? 0), 0) / team.length)
      : 0;

  const objectiveSummary = useMemo(() => summarizeObjectiveThemes(projects), [projects]);
  const recurringThemes = objectiveSummary.themes;
  const financeOutlook = useMemo(
    () =>
      summarizePortfolioFinanceOutlook({
        plannedBudget: totalPlan,
        actualSpend: totalFact,
        portfolioCpi: planFact?.portfolioCpi,
      }),
    [planFact?.portfolioCpi, totalFact, totalPlan]
  );
  const scenarioOutlook = useMemo(
    () =>
      summarizePortfolioScenarioOutlook({
        plannedBudget: totalPlan,
        actualSpend: totalFact,
        portfolioCpi: planFact?.portfolioCpi,
        totalCapacity: capacityTotals.capacity,
        allocatedCapacity: capacityTotals.allocated,
      }),
    [capacityTotals.allocated, capacityTotals.capacity, planFact?.portfolioCpi, totalFact, totalPlan]
  );

  const goalSignals = useMemo(() => {
    const behindPlan = planFact?.projectsBehindPlan ?? 0;
    const overBudget = planFact?.projectsOverBudget ?? 0;
    const staleReporting = planFact?.staleFieldReportingProjects ?? 0;

    return [
      {
        icon: CalendarDays,
        title: t("portfolio.goalDeliveryTitle"),
        description: t("portfolio.goalDeliveryDescription"),
        action: t("portfolio.goalDeliveryAction"),
        value: behindPlan,
        variant: getCountVariant(behindPlan),
        progress: behindPlan === 0 ? 100 : Math.max(0, 100 - behindPlan * 25),
      },
      {
        icon: Wallet,
        title: t("portfolio.goalBudgetTitle"),
        description: t("portfolio.goalBudgetDescription"),
        action: t("portfolio.goalBudgetAction"),
        value: overBudget,
        variant: getCountVariant(overBudget),
        progress: overBudget === 0 ? 100 : Math.max(0, 100 - overBudget * 25),
      },
      {
        icon: FileText,
        title: t("portfolio.goalEvidenceTitle"),
        description: t("portfolio.goalEvidenceDescription"),
        action: t("portfolio.goalEvidenceAction"),
        value: staleReporting,
        variant: getCountVariant(staleReporting),
        progress: staleReporting === 0 ? 100 : Math.max(0, 100 - staleReporting * 25),
      },
    ];
  }, [planFact?.projectsBehindPlan, planFact?.projectsOverBudget, planFact?.staleFieldReportingProjects, t]);

  const topRecommendations = useMemo(
    () => recommendations.slice(0, 4),
    [recommendations]
  );

  const upcomingMilestones = useMemo(() => {
    return projects
      .filter((project) => project.nextMilestone)
      .map((project) => ({
        project,
        milestone: project.nextMilestone!,
        timestamp: new Date(project.nextMilestone!.date).getTime(),
      }))
      .filter((entry) => !Number.isNaN(entry.timestamp))
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(0, 4);
  }, [projects]);

  const atRiskProjects = useMemo(() => {
    return [...projects]
      .filter((project) => project.status === "at-risk" || project.health < 60)
      .sort((left, right) => left.health - right.health)
      .slice(0, 4);
  }, [projects]);

  const overloadedMembers = useMemo(() => {
    return [...capacityRows]
      .sort((left, right) => {
        const leftRatio = left.capacity > 0 ? left.allocated / left.capacity : 0;
        const rightRatio = right.capacity > 0 ? right.allocated / right.capacity : 0;
        return rightRatio - leftRatio;
      })
      .filter((member) => member.allocated >= 65)
      .slice(0, 4);
  }, [capacityRows]);

  const overloadedMembersCount = overloadedMembers.length;
  const capacityOutlook = useMemo(
    () =>
      summarizePortfolioCapacityOutlook({
        totalCapacity: capacityTotals.capacity,
        allocatedCapacity: capacityTotals.allocated,
        availableCapacity: capacityTotals.available,
        overloadedCapacity: capacityTotals.overloaded,
        overloadedMembersCount,
      }),
    [capacityTotals.allocated, capacityTotals.available, capacityTotals.capacity, capacityTotals.overloaded, overloadedMembersCount]
  );

  const objectiveThemeCount = recurringThemes.length;
  const isBusy = snapshotLoading || overviewLoading || budgetLoading || riskLoading || capacityLoading;
  const hasHardError = snapshotError && !projects.length && !tasks.length && !team.length && !snapshotRisks.length;

  const refreshAll = () => {
    retry();
    void refreshOverview?.();
    void refreshRecommendations?.();
    void refreshBudget?.();
    void refreshRisk?.();
    void refreshCapacity?.();
  };

  if (hasHardError) {
    return (
      <Card className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-4">
        <CardContent className="flex flex-col items-center justify-center gap-3 p-0 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">{t("error.loadTitle")}</h2>
            <p className="max-w-xl text-sm text-[var(--ink-soft)]">{t("error.loadDescription")}</p>
          </div>
          <Button onClick={refreshAll} size="sm" variant="outline">
            {t("action.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3" data-testid="portfolio-page">
      <section className="overflow-hidden rounded-3xl border border-[var(--line-strong)] bg-[linear-gradient(180deg,rgba(14,165,233,0.14)_0%,rgba(15,23,42,0.02)_100%)] p-3 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
        <div className="grid gap-3 xl:grid-cols-[1.45fr_0.55fr]">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-panel)]/85 px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">
              <Target className="h-3.5 w-3.5 text-[var(--brand)]" />
              {t("page.portfolio.eyebrow")}
            </div>
            <h1 className="mt-3 text-lg font-semibold tracking-[-0.06em] text-[var(--ink)] sm:text-2xl">
              {t("page.portfolio.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--ink-soft)]">
              {t("page.portfolio.description")}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link className={buttonVariants({ variant: "default", size: "sm" })} href="/projects">
                <BriefcaseBusiness className="h-4 w-4" />
                {t("nav.projects")}
              </Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/goals">
                <Target className="h-4 w-4" />
                Цели
              </Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/analytics">
                <Gauge className="h-4 w-4" />
                {t("nav.analytics")}
              </Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/command-center">
                <ShieldAlert className="h-4 w-4" />
                {t("nav.commandCenter")}
              </Link>
              <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/briefs">
                <Sparkles className="h-4 w-4" />
                {t("nav.briefs")}
              </Link>
            </div>
          </div>

    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
            {overviewError ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-panel)]/90 p-3 text-sm text-[var(--ink-soft)]">
                {overviewError instanceof Error ? overviewError.message : t("error.loadDescription")}
              </div>
            ) : null}
            <MiniSignalCard
              icon={Target}
              label={t("portfolio.signal.health")}
              value={`${portfolioHealth?.overall ?? 0}%`}
              variant={portfolioHealth && portfolioHealth.overall >= 70 ? "success" : "warning"}
              description={t("portfolio.signal.healthDescription")}
            />
            <MiniSignalCard
              icon={AlertTriangle}
              label={t("portfolio.signal.overdue")}
              value={String(overdueTasks)}
              variant={overdueTasks > 0 ? "danger" : "success"}
              description={t("portfolio.signal.overdueDescription")}
            />
            <MiniSignalCard
              icon={Wallet}
              label={t("portfolio.signal.cpi")}
              value={formatRatio(planFact?.portfolioCpi)}
              variant={(planFact?.portfolioCpi ?? 0) >= 1 ? "success" : "warning"}
              description={t("portfolio.signal.cpiDescription")}
            />
            <MiniSignalCard
              icon={Users}
              label={t("portfolio.signal.resources")}
              value={`${teamUtilization}%`}
              variant={teamUtilization <= 80 ? "success" : teamUtilization <= 100 ? "warning" : "danger"}
              description={t("portfolio.signal.resourcesDescription")}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          icon={Target}
          label={t("portfolio.metric.health")}
          value={`${portfolioHealth?.overall ?? 0}%`}
          description={t("portfolio.metric.healthDescription")}
          variant={portfolioHealth && portfolioHealth.overall >= 70 ? "success" : "warning"}
        />
        <MetricCard
          icon={CalendarDays}
          label={t("portfolio.metric.overdue")}
          value={String(overdueTasks)}
          description={t("portfolio.metric.overdueDescription")}
          variant={overdueTasks > 0 ? "danger" : "success"}
        />
        <MetricCard
          icon={Wallet}
          label={t("portfolio.metric.cpi")}
          value={formatRatio(planFact?.portfolioCpi)}
          description={t("portfolio.metric.cpiDescription")}
          variant={(planFact?.portfolioCpi ?? 0) >= 1 ? "success" : "warning"}
        />
        <MetricCard
          icon={Gauge}
          label={t("portfolio.metric.spi")}
          value={formatRatio(planFact?.portfolioSpi)}
          description={t("portfolio.metric.spiDescription")}
          variant={(planFact?.portfolioSpi ?? 0) >= 1 ? "success" : "warning"}
        />
        <MetricCard
          icon={BriefcaseBusiness}
          label={t("portfolio.metric.behindPlan")}
          value={String(planFact?.projectsBehindPlan ?? 0)}
          description={t("portfolio.metric.behindPlanDescription")}
          variant={(planFact?.projectsBehindPlan ?? 0) > 0 ? "warning" : "success"}
        />
        <MetricCard
          icon={Sparkles}
          label={t("portfolio.metric.overBudget")}
          value={String(planFact?.projectsOverBudget ?? 0)}
          description={t("portfolio.metric.overBudgetDescription")}
          variant={(planFact?.projectsOverBudget ?? 0) > 0 ? "danger" : "success"}
        />
      </div>

      <section className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]" data-testid="portfolio-forecast">
        <Card className="min-w-0" data-testid="portfolio-forecast-finance">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-[var(--brand)]" />
              Прогноз бюджета
            </CardTitle>
            <CardDescription>
              Показываем, к чему ведёт текущий CPI и сколько денег может потребоваться до завершения портфеля.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">План</p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {formatCurrency(financeOutlook.plannedBudget, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Факт</p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {formatCurrency(financeOutlook.actualSpend, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Прогноз</p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {formatCurrency(financeOutlook.forecastAtCompletion, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Отклонение</p>
                <p className={cn(
                  "mt-1 text-lg font-semibold tracking-[-0.05em]",
                  financeOutlook.tone === "danger" && "text-rose-600",
                  financeOutlook.tone === "warning" && "text-amber-600",
                  financeOutlook.tone === "success" && "text-emerald-600"
                )}>
                  {financeOutlook.forecastVariance >= 0 ? "+" : ""}
                  {formatCurrency(financeOutlook.forecastVariance, "RUB", locale)}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Следующий шаг</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    {financeOutlook.tone === "danger"
                      ? "Проверить ближайшие расходы и переподтвердить forecast до конца периода."
                      : financeOutlook.tone === "warning"
                        ? "Следить за forecast и подтвердить, что отклонение остаётся управляемым."
                        : "Forecast стабилен. Держим курс и продолжаем следить за фактом."}
                  </p>
                </div>
                <Badge variant={financeOutlook.tone === "danger" ? "danger" : financeOutlook.tone === "warning" ? "warning" : "success"}>
                  {financeOutlook.currentUsagePercent}% из плана
                </Badge>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущий расход</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                    {financeOutlook.currentUsagePercent}%
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Осталось</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                    {formatCurrency(financeOutlook.remainingBudget, "RUB", locale)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Прогноз от плана</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                    {financeOutlook.forecastUsagePercent}%
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0" data-testid="portfolio-forecast-capacity">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-[var(--brand)]" />
              Прогноз по capacity
            </CardTitle>
            <CardDescription>
              Смотрим, где уже появляется перегрузка и сколько запаса осталось на следующий цикл.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <MiniSignalCard
                icon={Users}
                label="Занято"
                value={`${capacityOutlook.utilizationPercent}%`}
                variant={capacityOutlook.tone === "danger" ? "danger" : capacityOutlook.tone === "warning" ? "warning" : "success"}
                description="Доля capacity, которая уже использована."
              />
              <MiniSignalCard
                icon={AlertTriangle}
                label="Перегружено"
                value={String(capacityOutlook.overloadedMembersCount)}
                variant={capacityOutlook.overloadedMembersCount > 0 ? "danger" : "success"}
                description="Сколько людей уже выше безопасного порога."
              />
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Следующий шаг</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    {capacityOutlook.tone === "danger"
                      ? "Снизить перегрузку и перераспределить assignments до следующего цикла."
                      : capacityOutlook.tone === "warning"
                        ? "Почти достигли безопасного порога. Лучше заранее перераспределить часть задач."
                        : "Запас capacity есть. Можно брать следующий поток работы без перегруза."}
                  </p>
                </div>
                <Badge variant={capacityOutlook.tone === "danger" ? "danger" : capacityOutlook.tone === "warning" ? "warning" : "success"}>
                  {capacityOutlook.availableCapacity} свободно
                </Badge>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    capacityOutlook.tone === "danger" && "bg-rose-500",
                    capacityOutlook.tone === "warning" && "bg-amber-500",
                    capacityOutlook.tone === "success" && "bg-emerald-500"
                  )}
                  style={{ width: `${Math.min(capacityOutlook.utilizationPercent, 100)}%` }}
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Всего</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.totalCapacity}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Занято</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.allocatedCapacity}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Перегрузка</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.overloadedCapacity}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]" data-testid="portfolio-goals">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-[var(--brand)]" />
              {t("portfolio.goalsTitle")}
            </CardTitle>
            <CardDescription>{t("portfolio.goalsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              {goalSignals.map((goal) => {
                const Icon = goal.icon;
                return (
                  <div key={goal.title} className={cn("rounded-2xl border p-3", toneClasses[goal.variant])}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 rounded-xl bg-white/70 p-2 text-[var(--ink)] shadow-sm dark:bg-black/20">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                            {goal.action}
                          </p>
                          <h3 className="mt-1 text-sm font-semibold text-[var(--ink)]">{goal.title}</h3>
                        </div>
                      </div>
                      <Badge variant={goal.variant}>{goal.value}</Badge>
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-[var(--ink-soft)]">{goal.description}</p>
                    <Progress className="mt-3 h-2" value={goal.progress} />
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("portfolio.themesTitle")}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {t("portfolio.themesDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="neutral">
                    {objectiveThemeCount} {t("portfolio.themesBadge")}
                  </Badge>
                  <Badge variant="info">{objectiveSummary.coveragePercent}% покрытия</Badge>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {recurringThemes.slice(0, 3).map((theme) => (
                  <div
                    key={theme.objective}
                    className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-panel)] p-3"
                  >
                    <div className="mt-0.5 rounded-lg bg-[var(--brand)]/10 p-2 text-[var(--brand)]">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-6 text-[var(--ink)]">{theme.objective}</p>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        {theme.count} {t("portfolio.objectiveCoverage")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--ink-soft)]">
                {t("portfolio.objectivesNote", {
                  themes: objectiveThemeCount,
                  projects: projects.length,
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3" data-testid="portfolio-actions">
          <PortfolioHealthCard healthScore={portfolioHealth ?? { overall: 0, budget: 0, schedule: 0, risk: 0, resource: 0 }} isLoading={isBusy && !portfolioHealth} />

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("portfolio.recommendationsTitle")}</CardTitle>
                  <CardDescription>{t("portfolio.recommendationsDescription")}</CardDescription>
                </div>
                {recommendationSummary ? (
                  <div className="flex flex-wrap gap-2">
                    {recommendationSummary.critical > 0 ? (
                      <Badge variant="danger">{recommendationSummary.critical} critical</Badge>
                    ) : null}
                    {recommendationSummary.high > 0 ? (
                      <Badge variant="warning">{recommendationSummary.high} high</Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardHeader>
          <CardContent className="space-y-2.5">
              {recommendationsError ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm text-[var(--ink-soft)]">
                  {recommendationsError instanceof Error ? recommendationsError.message : t("error.loadDescription")}
                </div>
              ) : recommendationsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-[var(--panel-soft)]" />
                  ))}
                </div>
              ) : topRecommendations.length ? (
                topRecommendations.map((recommendation) => (
                  <RecommendationCard
                    key={`${recommendation.projectId}-${recommendation.title}-${recommendation.priority}`}
                    recommendation={recommendation}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {t("recommendations.noRecommendations")}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/command-center">
                  {t("nav.commandCenter")}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/briefs">
                  {t("nav.briefs")}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]" data-testid="portfolio-finance">
        <div className="space-y-3">
          <Card className="min-w-0" data-testid="portfolio-finance-summary">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-[var(--brand)]" />
                {t("dashboard.progressVsBudget")}
              </CardTitle>
              <CardDescription>{t("dashboard.progressVsBudgetDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("portfolio.finance.plan")}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.06em] text-[var(--ink)]">
                    {formatCurrency(totalPlan, "RUB", locale)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {t("portfolio.finance.planDescription")}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("portfolio.finance.fact")}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.06em] text-[var(--ink)]">
                    {formatCurrency(totalFact, "RUB", locale)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {t("portfolio.finance.factDescription")}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("portfolio.finance.used")}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.06em] text-[var(--ink)]">
                    {budgetUsed.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {budgetUsed > 100 ? t("portfolio.finance.overBudget") : t("portfolio.finance.withinBudget")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {budgetError ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm text-[var(--ink-soft)]">
              {budgetError instanceof Error ? budgetError.message : t("error.loadDescription")}
            </div>
          ) : null}
          <BudgetChart data={budgetData} loading={budgetLoading} />
        </div>

        <Card className="min-w-0" data-testid="portfolio-resources">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-[var(--brand)]" />
              {t("portfolio.resourcesTitle")}
            </CardTitle>
            <CardDescription>{t("portfolio.resourcesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniSignalCard
                icon={Users}
                label={t("portfolio.resource.capacity")}
                value={String(capacityTotals.capacity)}
                variant={capacityTotals.capacity > 0 ? "info" : "warning"}
                description={t("portfolio.resource.capacityDescription")}
              />
              <MiniSignalCard
                icon={AlertTriangle}
                label={t("portfolio.resource.overloaded")}
                value={String(capacityTotals.overloaded)}
                variant={capacityTotals.overloaded > 0 ? "danger" : "success"}
                description={t("portfolio.resource.overloadedDescription")}
              />
            </div>

            <div className="space-y-2">
              {capacityError ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm text-[var(--ink-soft)]">
                  {capacityError instanceof Error ? capacityError.message : t("error.loadDescription")}
                </div>
              ) : capacityLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-14 animate-pulse rounded-xl bg-[var(--panel-soft)]" />
                  ))}
                </div>
              ) : overloadedMembers.length ? (
                overloadedMembers.map((member) => (
                  <div key={member.memberName} className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)]">{member.memberName}</p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {member.projectsCount} {t("portfolio.resource.assignedProjects")}
                        </p>
                      </div>
                      <Badge variant={member.allocated >= 100 ? "danger" : member.allocated >= 85 ? "warning" : "info"}>
                        {member.allocated}%
                      </Badge>
                    </div>
                    <Progress className="mt-3 h-2" value={Math.min(member.allocated, 100)} />
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {t("portfolio.resource.noOverload")}
                </div>
              )}
            </div>

            <TeamPerformanceLazy />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-2" data-testid="portfolio-scenarios">
        <Card className="min-w-0" data-testid="portfolio-scenario-finance">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-[var(--brand)]" />
              Сценарий бюджета
            </CardTitle>
            <CardDescription>
              Сравниваем текущий forecast с нейтральным сценарием, где CPI возвращается к 1.00.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  scenarioOutlook.finance.tone === "danger"
                    ? "danger"
                    : scenarioOutlook.finance.tone === "warning"
                      ? "warning"
                      : "success"
                }
              >
                CPI 1.00
              </Badge>
              <Badge variant="neutral">Нейтральный сценарий</Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущий forecast</p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {formatCurrency(scenarioOutlook.finance.baselineForecastAtCompletion, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">При CPI 1.00</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {formatCurrency(scenarioOutlook.finance.neutralForecastAtCompletion, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Разница</p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tracking-[-0.05em]",
                    scenarioOutlook.finance.forecastDelta > 0 && "text-rose-600",
                    scenarioOutlook.finance.forecastDelta < 0 && "text-emerald-600"
                  )}
                >
                  {scenarioOutlook.finance.forecastDelta >= 0 ? "+" : ""}
                  {formatCurrency(scenarioOutlook.finance.forecastDelta, "RUB", locale)}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Что это значит</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                {scenarioOutlook.finance.forecastDelta > 0
                  ? "Чтобы вернуться к нейтральному сценарию, нужно сократить перерасход и вернуть CPI к плановому уровню."
                  : scenarioOutlook.finance.forecastDelta < 0
                    ? "Текущий forecast лучше нейтрального сценария. Можно удерживать дисциплину и не терять запас."
                    : "Текущий forecast уже совпадает с нейтральным сценарием. Дальше важна стабильность исполнения."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0" data-testid="portfolio-scenario-capacity">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-[var(--brand)]" />
              Сценарий загрузки
            </CardTitle>
            <CardDescription>
              Смотрим, сколько capacity нужно освободить, чтобы держать загрузку не выше 80%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  scenarioOutlook.capacity.tone === "danger"
                    ? "danger"
                    : scenarioOutlook.capacity.tone === "warning"
                      ? "warning"
                      : "success"
                }
              >
                80% загрузка
              </Badge>
              <Badge variant="neutral">
                Цель {scenarioOutlook.capacity.targetAllocatedCapacity} единиц
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущая загрузка</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {scenarioOutlook.capacity.currentUtilizationPercent}%
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Цель</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                  {scenarioOutlook.capacity.targetUtilizationPercent}%
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  {scenarioOutlook.capacity.utilizationGapCapacity > 0 ? "Нужно освободить" : "Запас до цели"}
                </p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tracking-[-0.05em]",
                    scenarioOutlook.capacity.utilizationGapCapacity > 0 && "text-rose-600",
                    scenarioOutlook.capacity.utilizationGapCapacity === 0 && "text-emerald-600",
                    scenarioOutlook.capacity.utilizationGapCapacity < 0 && "text-sky-600"
                  )}
                >
                  {scenarioOutlook.capacity.utilizationGapCapacity > 0
                    ? `${scenarioOutlook.capacity.releaseNeededToTarget} ед.`
                    : `${scenarioOutlook.capacity.spareCapacityToTarget} ед.`}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Что это значит</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                {scenarioOutlook.capacity.utilizationGapCapacity > 0
                  ? "Чтобы не выходить за безопасную загрузку, нужно освободить часть capacity или перенести assignments."
                  : scenarioOutlook.capacity.utilizationGapCapacity < 0
                    ? "Есть запас до безопасной загрузки. Можно брать новый поток работы без перегруза."
                    : "Загрузка уже на целевом уровне. Это хороший момент удержать текущий ритм."}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]" data-testid="portfolio-timeline">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-[var(--brand)]" />
              {t("portfolio.timelineTitle")}
            </CardTitle>
            <CardDescription>{t("portfolio.timelineDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {upcomingMilestones.map(({ project, milestone }) => (
                <div
                  key={`${project.id}-${milestone.date}`}
                  className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("portfolio.upcomingMilestones")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm font-medium text-[var(--ink)]">{milestone.name}</p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">{project.name}</p>
                  <p className="mt-2 text-xs font-medium text-[var(--brand)]">
                    {formatDateLocalized(milestone.date, "d MMM")}
                  </p>
                </div>
              ))}
            </div>
            <ProjectTimeline />
          </CardContent>
        </Card>

        <Card className="min-w-0" data-testid="portfolio-risks">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-[var(--brand)]" />
              {t("portfolio.riskTitle")}
            </CardTitle>
            <CardDescription>{t("portfolio.riskDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {riskError ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm text-[var(--ink-soft)]">
                {riskError instanceof Error ? riskError.message : t("error.loadDescription")}
              </div>
            ) : riskLoading ? (
              <ChartSkeleton className="h-[420px]" />
            ) : (
              <RiskMatrix data={riskData} loading={riskLoading} />
            )}

            <div className="space-y-2">
              {atRiskProjects.length ? (
                atRiskProjects.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)]">{project.name}</p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {formatCurrency(project.budget.actual, project.budget.currency, locale)} · {project.health}%
                        </p>
                      </div>
                      <Badge variant={project.health >= 70 ? "warning" : "danger"}>
                        {project.status}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {t("portfolio.riskClean")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MiniSignalCard({
  icon: Icon,
  label,
  value,
  variant,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  variant: "success" | "warning" | "danger" | "info";
  description: string;
}) {
  return (
    <div className={cn("rounded-2xl border p-2.5", toneClasses[variant])}>
      <div className="flex items-start gap-2.5">
        <div className="rounded-xl bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Icon className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
          <p className="mt-1 text-lg font-semibold tracking-[-0.08em] text-[var(--ink)]">{value}</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{description}</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  variant,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
  variant: "success" | "warning" | "danger" | "info";
}) {
  const variantStyles = {
    success: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
    warning: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
    danger: "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30",
    info: "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
  } as const;

  return (
    <div className={cn("rounded-2xl border p-2.5", variantStyles[variant])} data-testid="portfolio-metric-card">
      <div className="flex items-start gap-2.5">
        <div className="rounded-xl bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Icon className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
          <p className="mt-1 text-base font-semibold tracking-[-0.08em] text-[var(--ink)]">{value}</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{description}</p>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: AnalyticsRecommendation }) {
  const { t } = useLocale();

  return (
    <div className={cn("rounded-2xl border p-2.5", getRecommendationTone(recommendation.priority))}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Sparkles className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
              {recommendation.title}
            </p>
            <Badge variant={getPriorityVariant(recommendation.priority)}>
              {recommendation.priority}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">
            {recommendation.description}
          </p>
          <p className="mt-2 text-xs font-medium text-[var(--ink)]">{recommendation.action}</p>
          {recommendation.projectName ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">{recommendation.projectName}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="neutral">{t(`recommendations.types.${recommendation.type}`)}</Badge>
        <Link className="text-xs font-semibold text-[var(--brand)]" href="/command-center">
          {t("action.open")}
        </Link>
      </div>
    </div>
  );
}
