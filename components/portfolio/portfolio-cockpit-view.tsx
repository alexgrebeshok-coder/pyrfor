"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  Gauge,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import type { HealthScore } from "@/lib/ai/health-calculator";
import type { RiskData } from "@/lib/types/analytics";
import type { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

import { MetricCard, MiniSignalCard, formatRatio } from "./portfolio-cards";
import { PortfolioFinanceSection, type PortfolioFinanceSectionProps } from "./portfolio-finance-section";
import { PortfolioForecastSection, type PortfolioForecastSectionProps } from "./portfolio-forecast-section";
import { PortfolioGoalsSection, type PortfolioGoalsSectionProps } from "./portfolio-goals-section";
import { PortfolioScenariosSection, type PortfolioScenariosSectionProps } from "./portfolio-scenarios-section";

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

interface PortfolioCockpitSummary {
  overviewError: unknown;
  overdueTasks: number;
  portfolioCpi?: number;
  portfolioHealth: HealthScore | null;
  portfolioSpi?: number;
  projectsBehindPlan: number;
  projectsOverBudget: number;
  teamUtilization: number;
}

interface PortfolioCockpitTimelineRisk {
  atRiskProjects: Project[];
  riskData: RiskData[];
  riskError: unknown;
  riskLoading: boolean;
  upcomingMilestones: Array<{
    project: Project;
    milestone: NonNullable<Project["nextMilestone"]>;
  }>;
}

interface PortfolioCockpitViewProps {
  financeSection: PortfolioFinanceSectionProps;
  forecastSection: PortfolioForecastSectionProps;
  goalsSection: PortfolioGoalsSectionProps;
  hardErrorMessage: string | null;
  onRetry: () => void;
  scenarioOutlook: PortfolioScenariosSectionProps["scenarioOutlook"];
  summary: PortfolioCockpitSummary;
  timelineRisk: PortfolioCockpitTimelineRisk;
}

export function PortfolioCockpitView({
  financeSection,
  forecastSection,
  goalsSection,
  hardErrorMessage,
  onRetry,
  scenarioOutlook,
  summary,
  timelineRisk,
}: PortfolioCockpitViewProps) {
  const { t, formatDateLocalized, locale } = useLocale();

  if (hardErrorMessage) {
    return (
      <Card className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-4">
        <CardContent className="flex flex-col items-center justify-center gap-3 p-0 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">{t("error.loadTitle")}</h2>
            <p className="max-w-xl text-sm text-[var(--ink-soft)]">{hardErrorMessage}</p>
          </div>
          <Button onClick={onRetry} size="sm" variant="outline">
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
            {summary.overviewError ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-panel)]/90 p-3 text-sm text-[var(--ink-soft)]">
                {summary.overviewError instanceof Error ? summary.overviewError.message : t("error.loadDescription")}
              </div>
            ) : null}
            <MiniSignalCard
              description={t("portfolio.signal.healthDescription")}
              icon={Target}
              label={t("portfolio.signal.health")}
              value={String(summary.portfolioHealth?.overall ?? 0) + "%"}
              variant={summary.portfolioHealth && summary.portfolioHealth.overall >= 70 ? "success" : "warning"}
            />
            <MiniSignalCard
              description={t("portfolio.signal.overdueDescription")}
              icon={AlertTriangle}
              label={t("portfolio.signal.overdue")}
              value={String(summary.overdueTasks)}
              variant={summary.overdueTasks > 0 ? "danger" : "success"}
            />
            <MiniSignalCard
              description={t("portfolio.signal.cpiDescription")}
              icon={Wallet}
              label={t("portfolio.signal.cpi")}
              value={formatRatio(summary.portfolioCpi)}
              variant={(summary.portfolioCpi ?? 0) >= 1 ? "success" : "warning"}
            />
            <MiniSignalCard
              description={t("portfolio.signal.resourcesDescription")}
              icon={Users}
              label={t("portfolio.signal.resources")}
              value={String(summary.teamUtilization) + "%"}
              variant={
                summary.teamUtilization <= 80 ? "success" : summary.teamUtilization <= 100 ? "warning" : "danger"
              }
            />
          </div>
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          description={t("portfolio.metric.healthDescription")}
          icon={Target}
          label={t("portfolio.metric.health")}
          value={String(summary.portfolioHealth?.overall ?? 0) + "%"}
          variant={summary.portfolioHealth && summary.portfolioHealth.overall >= 70 ? "success" : "warning"}
        />
        <MetricCard
          description={t("portfolio.metric.overdueDescription")}
          icon={CalendarDays}
          label={t("portfolio.metric.overdue")}
          value={String(summary.overdueTasks)}
          variant={summary.overdueTasks > 0 ? "danger" : "success"}
        />
        <MetricCard
          description={t("portfolio.metric.cpiDescription")}
          icon={Wallet}
          label={t("portfolio.metric.cpi")}
          value={formatRatio(summary.portfolioCpi)}
          variant={(summary.portfolioCpi ?? 0) >= 1 ? "success" : "warning"}
        />
        <MetricCard
          description={t("portfolio.metric.spiDescription")}
          icon={Gauge}
          label={t("portfolio.metric.spi")}
          value={formatRatio(summary.portfolioSpi)}
          variant={(summary.portfolioSpi ?? 0) >= 1 ? "success" : "warning"}
        />
        <MetricCard
          description={t("portfolio.metric.behindPlanDescription")}
          icon={BriefcaseBusiness}
          label={t("portfolio.metric.behindPlan")}
          value={String(summary.projectsBehindPlan)}
          variant={summary.projectsBehindPlan > 0 ? "warning" : "success"}
        />
        <MetricCard
          description={t("portfolio.metric.overBudgetDescription")}
          icon={Sparkles}
          label={t("portfolio.metric.overBudget")}
          value={String(summary.projectsOverBudget)}
          variant={summary.projectsOverBudget > 0 ? "danger" : "success"}
        />
      </div>

      <PortfolioForecastSection {...forecastSection} />
      <PortfolioGoalsSection {...goalsSection} />
      <PortfolioFinanceSection {...financeSection} />
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
              {timelineRisk.upcomingMilestones.map(({ project, milestone }) => (
                <div
                  key={project.id + "-" + milestone.date}
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
            {timelineRisk.riskError ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-sm text-[var(--ink-soft)]">
                {timelineRisk.riskError instanceof Error ? timelineRisk.riskError.message : t("error.loadDescription")}
              </div>
            ) : timelineRisk.riskLoading ? (
              <ChartSkeleton className="h-[420px]" />
            ) : (
              <RiskMatrix data={timelineRisk.riskData} loading={timelineRisk.riskLoading} />
            )}

            <div className="space-y-2">
              {timelineRisk.atRiskProjects.length ? (
                timelineRisk.atRiskProjects.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)]">{project.name}</p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {formatCurrency(project.budget.actual, project.budget.currency, locale) + " · " + project.health + "%"}
                        </p>
                      </div>
                      <Badge variant={project.health >= 70 ? "warning" : "danger"}>{project.status}</Badge>
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
