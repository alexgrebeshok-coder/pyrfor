"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  Gauge,
  Search,
  Sparkles,
  Target,
  Wallet,
  Users,
} from "lucide-react";

import { DataErrorState } from "@/components/ui/data-error-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { useAnalyticsOverview } from "@/lib/hooks/use-analytics-overview";
import { useDashboardSnapshot } from "@/lib/hooks/use-api";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import { useTeamCapacity } from "@/lib/hooks/use-team-capacity";
import { summarizePortfolioScenarioOutlook } from "@/lib/portfolio/portfolio-outlook";
import type { Project } from "@/lib/types";
import { cn, formatCurrency, safePercent } from "@/lib/utils";

type GoalClusterKey = "delivery" | "budget" | "evidence" | "capacity";

type GoalCluster = {
  key: GoalClusterKey;
  title: string;
  description: string;
  nextAction: string;
  currentLabel: string;
  targetLabel: string;
  metricLabel: string;
  score: number;
  variant: "success" | "warning" | "danger" | "info";
  icon: typeof Target;
  highlights: string[];
};

type ProjectCardModel = {
  project: Project;
  warningCount: number;
  overdueTasks: number;
  budgetUsage: number;
};

function getVariant(count: number, thresholds = { warning: 1, danger: 3 }) {
  if (count === 0) return "success" as const;
  if (count <= thresholds.warning) return "warning" as const;
  if (count <= thresholds.danger) return "danger" as const;
  return "danger" as const;
}

function getScoreFromCount(count: number, step = 22) {
  if (count <= 0) return 100;
  return Math.max(18, 100 - count * step);
}

function ClusterCard({ cluster }: { cluster: GoalCluster }) {
  const Icon = cluster.icon;

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96 shadow-[0_10px_28px_rgba(15,23,42,.05)]">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--panel-soft)] p-3 text-[var(--brand)]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Целевой контур
              </p>
              <CardTitle className="mt-1 text-base tracking-[-0.04em]">{cluster.title}</CardTitle>
              <CardDescription className="mt-1 text-xs leading-5">{cluster.description}</CardDescription>
            </div>
          </div>
          <Badge variant={cluster.variant}>{cluster.metricLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
            <span>Оценка готовности</span>
            <span>{cluster.score}%</span>
          </div>
          <Progress className="h-2" value={cluster.score} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущий результат</p>
            <p className="mt-1 text-xs font-semibold tracking-[-0.03em] text-[var(--ink)]">{cluster.currentLabel}</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Целевой уровень</p>
            <p className="mt-1 text-xs font-semibold tracking-[-0.03em] text-[var(--ink)]">{cluster.targetLabel}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Следующее действие</p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink)]">{cluster.nextAction}</p>
        </div>
        <ul className="space-y-1.5 text-xs leading-5 text-[var(--ink-soft)]">
          {cluster.highlights.map((line) => (
            <li className="flex gap-3" key={line}>
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
function ProjectCardSkeleton() {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[color:var(--surface-panel)] p-3 shadow-[0_10px_28px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3" key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-10" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-2 w-full rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton className="h-6 w-20 rounded-full" key={index} />
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
    </article>
  );
}

export function GoalsPage() {
  const { enumLabel } = useLocale();
  const { projects, tasks, team, risks, isLoading: snapshotLoading, error: snapshotError, retry } = useDashboardSnapshot();
  const { data: overview, error: overviewError, isLoading: overviewLoading, refresh: refreshOverview } =
    useAnalyticsOverview();
  const { data: budgetData, error: budgetError, isLoading: budgetLoading, refresh: refreshBudget } =
    useBudgetData();
  const { rows: capacityRows, totals: capacityTotals, error: capacityError, isLoading: capacityLoading, refresh: refreshCapacity } =
    useTeamCapacity();
  const [query, setQuery] = useState("");
  const [activeObjective, setActiveObjective] = useState<string | null>(null);

  const overviewSummary = overview?.summary;
  const planFact = overviewSummary?.planFact;
  const isLoading = snapshotLoading || overviewLoading;
  const totalPlan = budgetData.reduce((sum, item) => sum + item.planned, 0);
  const totalFact = budgetData.reduce((sum, item) => sum + item.actual, 0);
  const budgetUsed = safePercent(totalFact, totalPlan);
  const capacityUtilization =
    capacityTotals.capacity > 0 ? safePercent(capacityTotals.allocated, capacityTotals.capacity) : 0;
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
    const overviewProjects = new Map(overview?.projects.map((item) => [item.projectId, item]) ?? []);
    return projects
      .map((project) => {
        const analytics = overviewProjects.get(project.id);
        return {
          project,
          warningCount: analytics?.planFact.warningCount ?? 0,
          overdueTasks: analytics?.overdueTasks ?? 0,
          budgetUsage:
            project.budget.planned > 0 ? safePercent(project.budget.actual, project.budget.planned) : 0,
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
              (objective) => objective.trim().toLowerCase() === activeObjective.trim().toLowerCase()
            )
          : true;
        const queryMatch = query.trim().length === 0 ? true : text.includes(query.trim().toLowerCase());
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
    () => capacityRows.filter((member) => member.capacity > 0 && member.allocated / member.capacity >= 0.9),
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
        description: "Не дать срокам расползтись и удержать ближайшие вехи под контролем.",
        nextAction: behindPlan > 0 ? "Сначала снять блокеры и вернуть отстающие проекты в рабочее окно." : "Ритм поставки сейчас стабилен. Держим фокус на ближайших вехах.",
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
        description: "Показываем, где расход и прогноз начинают отъедать управленческий запас.",
        nextAction: overBudget > 0 ? "Проверить перерасходы и подтвердить forecast до конца периода." : "Бюджет под контролем. Продолжаем следить за прогнозом и фактом.",
        currentLabel: `CPI ${portfolioCpi.toFixed(2)}`,
        targetLabel: "CPI не ниже 1.00",
        metricLabel: overBudget > 0 ? `${overBudget} выше плана` : `CPI ${portfolioCpi.toFixed(2)}`,
        score: overBudget > 0 ? getScoreFromCount(overBudget, 18) : Math.round(Math.min(100, Math.max(68, portfolioCpi * 100))),
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
        description: "Свежие field updates, отчёты и сигналы должны идти в ногу с работой.",
        nextAction: staleReporting > 0 ? "Вернуть регулярный reporting rhythm и обновить проблемные зоны." : "Доказательная база свежая. Поддерживаем ритм обновлений.",
        currentLabel: staleReporting > 0 ? `${staleReporting} устарели` : "Свежие отчёты",
        targetLabel: "0 устаревших отчётов",
        metricLabel: staleReporting > 0 ? `${staleReporting} без свежих отчётов` : "Свежо",
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
        description: "Не допустить перегрузки команды и оставить запас на recovery-work.",
        nextAction: overloadedCount > 0 ? "Снизить перегрузку и перераспределить assignments до следующего цикла." : "Ёмкость команды пока в безопасной зоне.",
        currentLabel: `${overloadedCount} перегружены`,
        targetLabel: "0 перегруженных участников",
        metricLabel: overloadedCount > 0 ? `${overloadedCount} перегружены` : "В запасе",
        score: overloadedCount > 0 ? getScoreFromCount(overloadedCount, 20) : Math.min(100, Math.max(72, Math.round((overviewSummary?.avgHealthScore ?? 0) * 1.05))),
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
  const priorityCluster = useMemo(() => {
    return [...clusters].sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))[0] ?? null;
  }, [clusters]);

  const hasHardError = snapshotError && !projects.length && !tasks.length && !team.length && !risks.length;
  const refreshAll = () => {
    retry();
    void refreshOverview?.();
    void refreshBudget?.();
    void refreshCapacity?.();
  };
  const showLoadingState = isLoading && projects.length === 0 && !overviewSummary;
  const projectCardsContent = useMemo(() => {
    if (showLoadingState) {
      return Array.from({ length: 4 }, (_, index) => <ProjectCardSkeleton key={index} />);
    }

    if (projectCards.length === 0) {
      return (
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/40 p-4 text-sm leading-6 text-[var(--ink-soft)] xl:col-span-2">
          {activeObjective
            ? `По цели «${activeObjective}» пока не нашлось проектов. Снимите фильтр или выберите другую цель, чтобы увидеть связанные проекты.`
            : "Пока проектов недостаточно, чтобы связать их с целями. Добавьте проект или дождитесь первой синхронизации, чтобы здесь появились цели и управленческие сигналы."}
        </div>
      );
    }

    return projectCards.map(({ project, overdueTasks, warningCount, budgetUsage }) => (
      <article
        className="rounded-3xl border border-[var(--line)] bg-[color:var(--surface-panel)] p-3 shadow-[0_14px_40px_rgba(15,23,42,.04)]"
        key={project.id}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              {project.location || "Проект"}
            </p>
            <h3 className="mt-1 text-base font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {project.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ink-soft)]">
              {project.description}
            </p>
          </div>
          <Badge variant={project.status === "at-risk" ? "danger" : project.status === "active" ? "success" : "neutral"}>
            {enumLabel("projectStatus", project.status)}
          </Badge>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Прогресс</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{project.progress}%</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Бюджет</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {project.budget.planned > 0 ? `${budgetUsage}%` : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Сигналы</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {warningCount + overdueTasks}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
            <span>Реализация</span>
            <span>{project.health}% здоровья</span>
          </div>
          <Progress className="mt-2 h-2" value={project.health} />
        </div>

        <div className="mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Связанные цели</p>
          <div className="flex flex-wrap gap-2">
            {project.objectives.slice(0, 3).map((objective) => (
              <Badge key={objective} variant="neutral">
                {objective}
              </Badge>
            ))}
            {project.objectives.length > 3 ? (
              <Badge variant="info">+{project.objectives.length - 3}</Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--ink-soft)]">
            План: {formatCurrency(project.budget.planned, "RUB")} · Факт: {formatCurrency(project.budget.actual, "RUB")}
          </p>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={`/projects/${project.id}`}
          >
            <ArrowUpRight className="h-4 w-4" />
            Открыть проект
          </Link>
        </div>
      </article>
    ));
  }, [activeObjective, enumLabel, projectCards, showLoadingState]);

  if (hasHardError) {
    return (
      <DataErrorState
        actionLabel="Попробовать снова"
        description="Не удалось загрузить цели и управленческий контекст. Можно повторить запрос или вернуться позже."
        onRetry={refreshAll}
        title="Не удалось загрузить цели"
      />
    );
  }

  return (
    <div className="grid gap-3" aria-busy={showLoadingState} data-testid="goals-page">
      <section className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(15,23,42,0.96)_0%,rgba(29,78,216,0.95)_55%,rgba(37,99,235,0.95)_100%)] text-white shadow-[0_24px_90px_rgba(15,23,42,.16)]">
        <div className="grid gap-3 p-3 lg:grid-cols-[1.15fr_.85fr] lg:p-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">Управленческий контур</Badge>
              <Badge variant="info">OKR</Badge>
              <Badge variant="success">Живые данные</Badge>
            </div>
            <div className="space-y-3">
              <h1 className="font-heading text-xl font-semibold tracking-[-0.06em] sm:text-2xl">
                Цели и ключевые результаты
              </h1>
              <p className="max-w-xl text-xs leading-5 text-slate-100/84">
                Здесь портфельные цели связываются с проектами, сигналами и следующими действиями.
                Это первая живая версия слоя целей и ключевых результатов (OKR), собранная из уже существующих данных.
              </p>
              {showLoadingState ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs tracking-[0.08em] text-slate-100/88">
                  <Skeleton className="h-2.5 w-2.5 rounded-full bg-white/70" />
                  Подтягиваем живые данные для целей
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className={buttonVariants({ variant: "default", size: "sm" })} href="/portfolio">
                <BriefcaseBusiness className="h-4 w-4" />
                Открыть портфель
              </Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/projects">
                <ArrowUpRight className="h-4 w-4" />
                Открыть проекты
              </Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/analytics">
                <Gauge className="h-4 w-4" />
                Смотреть аналитику
              </Link>
            </div>
          </div>

          <div className="grid gap-2 rounded-[24px] border border-white/12 bg-white/10 p-3 backdrop-blur">
            <div className="grid gap-2 sm:grid-cols-2">
              {showLoadingState
                ? Array.from({ length: 4 }, (_, index) => (
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3" key={index}>
                      <Skeleton className="h-3 w-28 bg-white/70" />
                      <Skeleton className="mt-2 h-9 w-16 bg-white/70" />
                      <Skeleton className="mt-2 h-4 w-full bg-white/70" />
                    </div>
                  ))
                : (
                  <>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">Целей в контуре</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">{clusters.length}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">Четыре управленческие оси для ежедневного контроля.</p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">Проектов в покрытии</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">{projects.length}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">Каждый проект связан с целями и сигналами.</p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">Перегруженные участники</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">{overloadedMembers.length}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">Слоты ёмкости, которые стоит защитить в ближайшем цикле.</p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">Отклонения плана</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">{planFact ? planFact.projectsBehindPlan + planFact.projectsOverBudget : 0}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">Сигналы, которые требуют управленческого решения.</p>
                    </div>
                  </>
                )}
            </div>
          </div>
        </div>
      </section>

      {overviewError ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm leading-6 text-amber-900 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Часть аналитических сигналов временно недоступна. Портфель и проекты показаны из живых данных, а
          некоторые управленческие счётчики могут обновиться после повторной синхронизации.
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.06em] text-[var(--ink)]">Ключевые результаты</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Четыре измеримых результата, по которым видно, идёт ли портфель к своим целям.
          </p>
        </div>
        <Badge variant="info">{objectiveSummary.coveragePercent}% покрытия</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {clusters.map((cluster) => (
          <ClusterCard cluster={cluster} key={cluster.key} />
        ))}
      </div>

      <section className="grid gap-3" data-testid="goal-priority">
        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base tracking-[-0.06em]">Приоритет внимания</CardTitle>
                <CardDescription>
                  Один экран, который показывает, какой контур требует решения первым и как он связан с целями, бюджетом и ёмкостью команды.
                </CardDescription>
              </div>
              <Badge variant={priorityCluster?.variant ?? "neutral"}>
                {priorityCluster ? priorityCluster.metricLabel : "—"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {budgetError || capacityError || budgetLoading || capacityLoading ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm leading-6 text-[var(--ink-soft)]">
                {budgetError || capacityError
                  ? "Часть финансового или ресурсного контекста временно недоступна. Остальные цели и сигналы уже видны."
                  : "Подтягиваем финансовый и ресурсный контекст для целей."}
              </div>
            ) : null}
            {priorityCluster ? (
              <>
                <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Самый срочный контур</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    {priorityCluster.title}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">{priorityCluster.nextAction}</p>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Покрытие целей</p>
                    <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                      {objectiveSummary.coveragePercent}%
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {objectiveSummary.coveredProjects} из {objectiveSummary.totalProjects} проектов с целями
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Бюджетный прогноз</p>
                    <p
                      className={cn(
                        "mt-1 text-base font-semibold tracking-[-0.05em]",
                        scenarioOutlook.finance.forecastDelta > 0 && "text-rose-600",
                        scenarioOutlook.finance.forecastDelta < 0 && "text-emerald-600"
                      )}
                    >
                      {scenarioOutlook.finance.forecastDelta >= 0 ? "+" : ""}
                      {formatCurrency(scenarioOutlook.finance.forecastDelta, "RUB")}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {planFact?.portfolioCpi
                        ? `Факт/план ${budgetUsed}% · CPI ${planFact.portfolioCpi.toFixed(2)} · нейтральный сценарий CPI 1.00`
                        : `Факт/план ${budgetUsed}% · нейтральный сценарий CPI 1.00`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Загрузка команды</p>
                    <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                      {capacityUtilization}%
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {scenarioOutlook.capacity.utilizationGapCapacity > 0
                        ? `Нужно освободить ${scenarioOutlook.capacity.releaseNeededToTarget} ед. ёмкости до 80%`
                        : "Загрузка ниже безопасного порога"}
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Почему это важно</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">
                    {priorityCluster.highlights.map((line) => (
                      <li className="flex gap-2" key={line}>
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link className={buttonVariants({ variant: "default", size: "sm" })} href="/portfolio">
                    <ArrowUpRight className="h-4 w-4" />
                    Открыть портфель
                  </Link>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/analytics">
                    <Gauge className="h-4 w-4" />
                    Смотреть аналитику
                  </Link>
                </div>
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm leading-6 text-[var(--ink-soft)]">
                Пока данных недостаточно, чтобы выделить приоритет. Как только появятся цели, проекты и сигналы, здесь отобразится первый управленческий фокус.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base tracking-[-0.06em]">Проекты и цели</CardTitle>
                <CardDescription>Каждый проект показывает собственные цели, чтобы связь с целями была видна сразу.</CardDescription>
              </div>
              <Badge variant="neutral">{projectCards.length} проектов</Badge>
            </div>
            <div className="space-y-2" data-testid="objective-filters">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Фильтр по целям</p>
              {topObjectiveThemes.length === 0 ? (
                <div
                  className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-xs leading-6 text-[var(--ink-soft)]"
                  data-testid="objective-filters-empty"
                >
                  Пока управленческих тем нет. Добавьте цели в проекты, и здесь появится фильтр по связанным темам.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonVariants({
                      variant: activeObjective === null ? "default" : "outline",
                      size: "sm",
                      className: "h-8 rounded-full px-3 text-xs",
                    })}
                    onClick={() => setActiveObjective(null)}
                    type="button"
                  >
                    Все цели
                  </button>
                  {topObjectiveThemes.map((theme, index) => (
                    <button
                      aria-pressed={activeObjective === theme.objective}
                      className={buttonVariants({
                        variant: activeObjective === theme.objective ? "default" : "outline",
                        size: "sm",
                        className: "h-8 rounded-full px-3 text-xs",
                      })}
                      data-testid={index === 0 ? "objective-filter-first" : undefined}
                      key={theme.objective}
                      onClick={() => setActiveObjective(theme.objective)}
                      type="button"
                    >
                      {theme.objective}
                    </button>
                  ))}
                  {activeObjective ? (
                    <Badge data-testid="active-objective-filter" variant="info">
                      Фильтр: {activeObjective}
                    </Badge>
                  ) : null}
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                className={cn(fieldStyles, "h-11 w-full text-sm !py-1.5 leading-normal")}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по проектам и целям"
                value={query}
              />
              <div className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 px-3 py-2 text-xs text-[var(--ink-soft)]">
                <Search className="h-4 w-4" />
                Фокус на поиске
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 xl:grid-cols-2">
              {projectCardsContent}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
          <CardHeader className="space-y-3">
            <CardTitle className="text-base tracking-[-0.06em]">Как это использовать</CardTitle>
            <CardDescription>Этот экран помогает руководителю быстро увидеть, какие цели требуют внимания, а какие уже можно удерживать на ритме.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">1. Смотрите на отклонения</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Начинайте с отстающих, перерасхода и перегруженных участников.</p>
            </div>
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">2. Переходите к проектам</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Каждую цель можно связать с конкретным проектом и его целями.</p>
            </div>
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">3. Превращайте сигнал в действие</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Следующий шаг должен быть понятен сразу, без поиска по всему приложению.</p>
            </div>
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">4. Возвращайтесь к портфелю</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Когда нужно увидеть полный контекст, откройте портфельную панель.</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
