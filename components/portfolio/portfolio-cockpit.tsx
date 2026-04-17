"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  FileText,
  Gauge,
  ShieldAlert,
  Sparkles,
  Target,
  Wallet,
  Users,
} from "lucide-react";

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
import { ChartSkeleton } from "@/components/ui/skeleton";
import { formatCurrency, safePercent } from "@/lib/utils";
import { MiniSignalCard, MetricCard, formatRatio, getCountVariant } from "./portfolio-cards";
import { PortfolioForecastSection } from "./portfolio-forecast-section";
import { PortfolioGoalsSection } from "./portfolio-goals-section";
import { PortfolioFinanceSection } from "./portfolio-finance-section";
import { PortfolioScenariosSection } from "./portfolio-scenarios-section";

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
            <p className="max-w-xl text-sm text-[var(--ink-soft)]">
              {snapshotError instanceof Error
                ? snapshotError.message
                : overviewError instanceof Error
                  ? overviewError.message
                  : budgetError instanceof Error
                    ? budgetError.message
                    : riskError instanceof Error
                      ? riskError.message
                      : capacityError instanceof Error
                        ? capacityError.message
                        : t("error.loadDescription")}
            </p>
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

      <PortfolioForecastSection financeOutlook={financeOutlook} capacityOutlook={capacityOutlook} />

      <PortfolioGoalsSection
          goalSignals={goalSignals}
          objectiveThemeCount={objectiveThemeCount}
          objectiveCoveragePercent={objectiveSummary.coveragePercent}
          recurringThemes={recurringThemes}
          projectsCount={projects.length}
          portfolioHealth={portfolioHealth}
          isBusy={isBusy}
          topRecommendations={topRecommendations}
          recommendationsError={recommendationsError ?? null}
          recommendationsLoading={recommendationsLoading}
          recommendationSummary={recommendationSummary ?? null}
        />

      <PortfolioFinanceSection
          totalPlan={totalPlan}
          totalFact={totalFact}
          budgetUsed={budgetUsed}
          budgetData={budgetData}
          budgetLoading={budgetLoading}
          budgetError={budgetError ?? null}
          capacityTotals={capacityTotals}
          capacityError={capacityError ?? null}
          capacityLoading={capacityLoading}
          overloadedMembers={overloadedMembers}
        />

      <PortfolioScenariosSection scenarioOutlook={scenarioOutlook} />

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

