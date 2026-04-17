"use client";

import { useMemo, useState } from "react";
import { Sparkles, Target, Users, Wallet } from "lucide-react";

import { DataErrorState } from "@/components/ui/data-error-state";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/contexts/locale-context";
import { ClusterCard } from "@/components/goals/goals-cluster-card";
import { GoalsHero } from "@/components/goals/goals-hero";
import { GoalsPlaybookCard } from "@/components/goals/goals-playbook-card";
import { GoalsPriorityPanel } from "@/components/goals/goals-priority-panel";
import { GoalsProjectsPanel } from "@/components/goals/goals-projects-panel";
import type { GoalCluster, ProjectCardModel } from "@/components/goals/goals-page.types";
import { getScoreFromCount, getVariant } from "@/components/goals/goals-page-utils";
import { useAnalyticsOverview } from "@/lib/hooks/use-analytics-overview";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useTeamCapacity } from "@/lib/hooks/use-team-capacity";
import { summarizePortfolioScenarioOutlook } from "@/lib/portfolio/portfolio-outlook";
import { safePercent } from "@/lib/utils";

export function GoalsPage() {
  const { enumLabel } = useLocale();
  const {
    projects,
    tasks,
    team,
    risks,
    isLoading: snapshotLoading,
    error: snapshotError,
    retry,
  } = useDashboardSnapshot();
  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    refresh: refreshOverview,
  } = useAnalyticsOverview();
  const {
    data: budgetData,
    error: budgetError,
    isLoading: budgetLoading,
    refresh: refreshBudget,
  } = useBudgetData();
  const {
    rows: capacityRows,
    totals: capacityTotals,
    error: capacityError,
    isLoading: capacityLoading,
    refresh: refreshCapacity,
  } = useTeamCapacity();
  const [query, setQuery] = useState("");
  const [activeObjective, setActiveObjective] = useState<string | null>(null);

  const overviewSummary = overview?.summary;
  const planFact = overviewSummary?.planFact;
  const isLoading = snapshotLoading || overviewLoading;
  const totalPlan = budgetData.reduce((sum, item) => sum + item.planned, 0);
  const totalFact = budgetData.reduce((sum, item) => sum + item.actual, 0);
  const budgetUsed = safePercent(totalFact, totalPlan);
  const capacityUtilization =
    capacityTotals.capacity > 0
      ? safePercent(capacityTotals.allocated, capacityTotals.capacity)
      : 0;
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
  const objectiveSummary = useMemo(() => summarizeObjectiveThemes(projects), [projects]);
  const topObjectiveThemes = objectiveSummary.themes.slice(0, 4);

  const projectCards = useMemo<ProjectCardModel[]>(() => {
    const overviewProjects = new Map(
      overview?.projects.map((item) => [item.projectId, item]) ?? []
    );

    return projects
      .map((project) => {
        const analytics = overviewProjects.get(project.id);
        return {
          project,
          warningCount: analytics?.planFact.warningCount ?? 0,
          overdueTasks: analytics?.overdueTasks ?? 0,
          budgetUsage:
            project.budget.planned > 0
              ? safePercent(project.budget.actual, project.budget.planned)
              : 0,
        };
      })
      .filter((item) => {
        const text = [
          item.project.name,
          item.project.description,
          item.project.location,
          item.project.objectives.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        const objectiveMatch = activeObjective
          ? item.project.objectives.some(
              (objective) =>
                objective.trim().toLowerCase() === activeObjective.trim().toLowerCase()
            )
          : true;
        const queryMatch =
          query.trim().length === 0
            ? true
            : text.includes(query.trim().toLowerCase());
        return objectiveMatch && queryMatch;
      })
      .sort((left, right) => {
        const leftRisk = left.project.status === "at-risk" ? 1 : 0;
        const rightRisk = right.project.status === "at-risk" ? 1 : 0;
        const riskDelta = rightRisk - leftRisk;
        if (riskDelta !== 0) return riskDelta;
        return right.project.progress - left.project.progress;
      });
  }, [activeObjective, overview?.projects, projects, query]);

  const overloadedMembers = useMemo(
    () =>
      capacityRows.filter(
        (member) => member.capacity > 0 && member.allocated / member.capacity >= 0.9
      ),
    [capacityRows]
  );

  const clusters = useMemo<GoalCluster[]>(() => {
    const behindPlan = planFact?.projectsBehindPlan ?? 0;
    const overBudget = planFact?.projectsOverBudget ?? 0;
    const staleReporting = planFact?.staleFieldReportingProjects ?? 0;
    const overloadedCount = overloadedMembers.length;
    const avgProgress = overviewSummary?.avgProgress ?? 0;
    const portfolioCpi = planFact?.portfolioCpi ?? 0;

    return [
      {
        key: "delivery",
        title: "Защитить ритм поставки",
        description:
          "Не дать срокам расползтись и удержать ближайшие вехи под контролем.",
        nextAction:
          behindPlan > 0
            ? "Сначала снять блокеры и вернуть отстающие проекты в рабочее окно."
            : "Ритм поставки сейчас стабилен. Держим фокус на ближайших вехах.",
        currentLabel: behindPlan > 0 ? `${behindPlan} проектов отстают` : "Отставаний нет",
        targetLabel: "0 отстающих проектов",
        metricLabel: behindPlan > 0 ? `${behindPlan} отстают` : "В норме",
        score: getScoreFromCount(behindPlan),
        variant: getVariant(behindPlan),
        icon: Target,
        highlights: [
          `Средний прогресс портфеля: ${avgProgress}%`,
          behindPlan > 0
            ? `В зоне внимания ${behindPlan} проектов, которые уже отстают от плана.`
            : "Проектов, заметно отстающих от плана, сейчас не видно.",
        ],
      },
      {
        key: "budget",
        title: "Держать бюджет под контролем",
        description:
          "Показываем, где расход и прогноз начинают отъедать управленческий запас.",
        nextAction:
          overBudget > 0
            ? "Проверить перерасходы и подтвердить forecast до конца периода."
            : "Бюджет под контролем. Продолжаем следить за прогнозом и фактом.",
        currentLabel: `CPI ${portfolioCpi.toFixed(2)}`,
        targetLabel: "CPI не ниже 1.00",
        metricLabel:
          overBudget > 0 ? `${overBudget} выше плана` : `CPI ${portfolioCpi.toFixed(2)}`,
        score:
          overBudget > 0
            ? getScoreFromCount(overBudget, 18)
            : Math.round(Math.min(100, Math.max(68, portfolioCpi * 100))),
        variant: getVariant(overBudget),
        icon: Wallet,
        highlights: [
          `Портфельный CPI: ${portfolioCpi.toFixed(2)}`,
          overBudget > 0
            ? `У ${overBudget} проектов фактический расход уже выше планового.`
            : "Проектов с явным перерасходом сейчас не видно.",
        ],
      },
      {
        key: "evidence",
        title: "Обновлять доказательную базу",
        description:
          "Свежие field updates, отчёты и сигналы должны идти в ногу с работой.",
        nextAction:
          staleReporting > 0
            ? "Вернуть регулярный reporting rhythm и обновить проблемные зоны."
            : "Доказательная база свежая. Поддерживаем ритм обновлений.",
        currentLabel: staleReporting > 0 ? `${staleReporting} устарели` : "Свежие отчёты",
        targetLabel: "0 устаревших отчётов",
        metricLabel:
          staleReporting > 0 ? `${staleReporting} без свежих отчётов` : "Свежо",
        score: getScoreFromCount(staleReporting),
        variant: getVariant(staleReporting),
        icon: Sparkles,
        highlights: [
          staleReporting > 0
            ? `У ${staleReporting} проектов отчёты устарели сильнее нормы.`
            : "Стареющих отчётов по портфелю сейчас не видно.",
          `Всего рисков в контуре: ${risks.length}`,
        ],
      },
      {
        key: "capacity",
        title: "Сохранять рабочую ёмкость",
        description:
          "Не допустить перегрузки команды и оставить запас на recovery-work.",
        nextAction:
          overloadedCount > 0
            ? "Снизить перегрузку и перераспределить assignments до следующего цикла."
            : "Ёмкость команды пока в безопасной зоне.",
        currentLabel: `${overloadedCount} перегружены`,
        targetLabel: "0 перегруженных участников",
        metricLabel: overloadedCount > 0 ? `${overloadedCount} перегружены` : "В запасе",
        score:
          overloadedCount > 0
            ? getScoreFromCount(overloadedCount, 20)
            : Math.min(
                100,
                Math.max(72, Math.round((overviewSummary?.avgHealthScore ?? 0) * 1.05))
              ),
        variant: getVariant(overloadedCount),
        icon: Users,
        highlights: [
          overloadedCount > 0
            ? `Перегруженных участников сейчас ${overloadedCount}.`
            : "Перегруженных участников сейчас не видно.",
          `Активных проектов в контуре: ${overviewSummary?.activeProjects ?? projects.length}`,
        ],
      },
    ];
  }, [overloadedMembers.length, overviewSummary, planFact, projects.length, risks.length]);

  const priorityCluster = useMemo(
    () =>
      [...clusters].sort(
        (left, right) => left.score - right.score || left.title.localeCompare(right.title)
      )[0] ?? null,
    [clusters]
  );

  const hasHardError =
    snapshotError && !projects.length && !tasks.length && !team.length && !risks.length;
  const refreshAll = () => {
    retry();
    void refreshOverview?.();
    void refreshBudget?.();
    void refreshCapacity?.();
  };
  const showLoadingState = isLoading && projects.length === 0 && !overviewSummary;

  if (hasHardError) {
    return (
      <DataErrorState
        actionLabel="Попробовать снова"
        description={
          snapshotError instanceof Error
            ? snapshotError.message
            : overviewError instanceof Error
              ? overviewError.message
              : budgetError instanceof Error
                ? budgetError.message
                : capacityError instanceof Error
                  ? capacityError.message
                  : "Не удалось загрузить цели и управленческий контекст. Можно повторить запрос или вернуться позже."
        }
        onRetry={refreshAll}
        title="Не удалось загрузить цели"
      />
    );
  }

  return (
    <div className="grid gap-3" aria-busy={showLoadingState} data-testid="goals-page">
      <GoalsHero
        clusters={clusters}
        deviationCount={
          planFact ? planFact.projectsBehindPlan + planFact.projectsOverBudget : 0
        }
        overloadedMembersCount={overloadedMembers.length}
        projectsCount={projects.length}
        showLoadingState={showLoadingState}
      />

      {overviewError ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm leading-6 text-amber-900 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Часть аналитических сигналов временно недоступна. Портфель и проекты
          показаны из живых данных, а некоторые управленческие счётчики могут
          обновиться после повторной синхронизации.
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.06em] text-[var(--ink)]">
            Ключевые результаты
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Четыре измеримых результата, по которым видно, идёт ли портфель к своим
            целям.
          </p>
        </div>
        <Badge variant="info">{objectiveSummary.coveragePercent}% покрытия</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {clusters.map((cluster) => (
          <ClusterCard cluster={cluster} key={cluster.key} />
        ))}
      </div>

      <GoalsPriorityPanel
        budgetError={budgetError}
        budgetLoading={budgetLoading}
        budgetUsed={budgetUsed}
        capacityError={capacityError}
        capacityLoading={capacityLoading}
        capacityUtilization={capacityUtilization}
        objectiveSummary={objectiveSummary}
        planFactCpi={planFact?.portfolioCpi}
        priorityCluster={priorityCluster}
        scenarioOutlook={scenarioOutlook}
      />

      <section className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <GoalsProjectsPanel
          activeObjective={activeObjective}
          enumLabel={enumLabel}
          onObjectiveChange={setActiveObjective}
          onQueryChange={setQuery}
          projectCards={projectCards}
          query={query}
          showLoadingState={showLoadingState}
          topObjectiveThemes={topObjectiveThemes}
        />
        <GoalsPlaybookCard />
      </section>
    </div>
  );
}
