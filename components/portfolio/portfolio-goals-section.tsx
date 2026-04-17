"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowUpRight, CheckCircle2, Target } from "lucide-react";

import { PortfolioHealthCard } from "@/components/analytics/portfolio-health-card";
import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AnalyticsRecommendation, AnalyticsRecommendationsSummary } from "@/lib/types/analytics";
import type { HealthScore } from "@/lib/ai/health-calculator";
import type { ObjectiveTheme } from "@/lib/goals/objective-summary";
import { toneClasses, RecommendationCard } from "./portfolio-cards";

export interface GoalSignal {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action: string;
  value: number;
  variant: "success" | "warning" | "danger";
  progress: number;
}

export interface PortfolioGoalsSectionProps {
  goalSignals: GoalSignal[];
  objectiveThemeCount: number;
  objectiveCoveragePercent: number;
  recurringThemes: ObjectiveTheme[];
  projectsCount: number;
  portfolioHealth: HealthScore | null;
  isBusy: boolean;
  topRecommendations: AnalyticsRecommendation[];
  recommendationsError: Error | unknown | null;
  recommendationsLoading: boolean;
  recommendationSummary: AnalyticsRecommendationsSummary | null;
}

export function PortfolioGoalsSection({
  goalSignals,
  objectiveThemeCount,
  objectiveCoveragePercent,
  recurringThemes,
  projectsCount,
  portfolioHealth,
  isBusy,
  topRecommendations,
  recommendationsError,
  recommendationsLoading,
  recommendationSummary,
}: PortfolioGoalsSectionProps) {
  const { t } = useLocale();

  return (
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
                <Badge variant="info">{objectiveCoveragePercent}% покрытия</Badge>
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
                projects: projectsCount,
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
  );
}
