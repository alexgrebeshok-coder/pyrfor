"use client";

import { useMemo } from "react";
import { CalendarDays, FileText, Wallet } from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import { calculatePortfolioHealth } from "@/lib/ai/health-calculator";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useAnalyticsOverview } from "@/lib/hooks/use-analytics-overview";
import { useAnalyticsRecommendations } from "@/lib/hooks/use-analytics-recommendations";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { useRiskData } from "@/lib/hooks/use-risk-data";
import { useTeamCapacity } from "@/lib/hooks/use-team-capacity";
import {
  summarizePortfolioCapacityOutlook,
  summarizePortfolioFinanceOutlook,
  summarizePortfolioScenarioOutlook,
} from "@/lib/portfolio/portfolio-outlook";
import { safePercent } from "@/lib/utils";

import { getCountVariant } from "./portfolio-cards";
import { PortfolioCockpitView } from "./portfolio-cockpit-view";

export function PortfolioCockpitPage() {
  const { t } = useLocale();
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
  const { data: riskData, error: riskError, isLoading: riskLoading, refresh: refreshRisk } = useRiskData();
  const {
    rows: capacityRows,
    totals: capacityTotals,
    error: capacityError,
    isLoading: capacityLoading,
    refresh: refreshCapacity,
  } = useTeamCapacity();

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
  const overdueTasks =
    overview?.summary.overdueTasks ??
    tasks.filter((task) => {
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

  const topRecommendations = useMemo(() => recommendations.slice(0, 4), [recommendations]);
  const upcomingMilestones = useMemo(
    () =>
      projects
        .filter((project) => project.nextMilestone)
        .map((project) => ({
          project,
          milestone: project.nextMilestone!,
          timestamp: new Date(project.nextMilestone!.date).getTime(),
        }))
        .filter((entry) => !Number.isNaN(entry.timestamp))
        .sort((left, right) => left.timestamp - right.timestamp)
        .slice(0, 4),
    [projects]
  );
  const atRiskProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => project.status === "at-risk" || project.health < 60)
        .sort((left, right) => left.health - right.health)
        .slice(0, 4),
    [projects]
  );
  const overloadedMembers = useMemo(
    () =>
      [...capacityRows]
        .sort((left, right) => {
          const leftRatio = left.capacity > 0 ? left.allocated / left.capacity : 0;
          const rightRatio = right.capacity > 0 ? right.allocated / right.capacity : 0;
          return rightRatio - leftRatio;
        })
        .filter((member) => member.allocated >= 65)
        .slice(0, 4),
    [capacityRows]
  );
  const capacityOutlook = useMemo(
    () =>
      summarizePortfolioCapacityOutlook({
        totalCapacity: capacityTotals.capacity,
        allocatedCapacity: capacityTotals.allocated,
        availableCapacity: capacityTotals.available,
        overloadedCapacity: capacityTotals.overloaded,
        overloadedMembersCount: overloadedMembers.length,
      }),
    [capacityTotals.allocated, capacityTotals.available, capacityTotals.capacity, capacityTotals.overloaded, overloadedMembers.length]
  );

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
  const hardErrorMessage = hasHardError
    ? snapshotError instanceof Error
      ? snapshotError.message
      : overviewError instanceof Error
        ? overviewError.message
        : budgetError instanceof Error
          ? budgetError.message
          : riskError instanceof Error
            ? riskError.message
            : capacityError instanceof Error
              ? capacityError.message
              : t("error.loadDescription")
    : null;

  return (
    <PortfolioCockpitView
      financeSection={{
        totalPlan,
        totalFact,
        budgetUsed,
        budgetData,
        budgetLoading,
        budgetError: budgetError ?? null,
        capacityTotals,
        capacityError: capacityError ?? null,
        capacityLoading,
        overloadedMembers,
      }}
      forecastSection={{ financeOutlook, capacityOutlook }}
      goalsSection={{
        goalSignals,
        objectiveThemeCount: recurringThemes.length,
        objectiveCoveragePercent: objectiveSummary.coveragePercent,
        recurringThemes,
        projectsCount: projects.length,
        portfolioHealth,
        isBusy,
        topRecommendations,
        recommendationsError: recommendationsError ?? null,
        recommendationsLoading,
        recommendationSummary: recommendationSummary ?? null,
      }}
      hardErrorMessage={hardErrorMessage}
      onRetry={refreshAll}
      scenarioOutlook={scenarioOutlook}
      summary={{
        overviewError,
        overdueTasks,
        portfolioCpi: planFact?.portfolioCpi,
        portfolioHealth,
        portfolioSpi: planFact?.portfolioSpi,
        projectsBehindPlan: planFact?.projectsBehindPlan ?? 0,
        projectsOverBudget: planFact?.projectsOverBudget ?? 0,
        teamUtilization,
      }}
      timelineRisk={{
        atRiskProjects,
        riskData,
        riskError: riskError ?? null,
        riskLoading,
        upcomingMilestones,
      }}
    />
  );
}
