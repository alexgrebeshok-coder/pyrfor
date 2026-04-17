"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, Users, Wallet } from "lucide-react";

import { TeamPerformanceLazy } from "@/components/analytics/team-performance-lazy";
import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import type { BudgetData } from "@/lib/types/analytics";
import type { TeamCapacityRow, TeamCapacityTotals } from "@/lib/hooks/use-team-capacity";
import { MiniSignalCard } from "./portfolio-cards";

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

export interface PortfolioFinanceSectionProps {
  totalPlan: number;
  totalFact: number;
  budgetUsed: number;
  budgetData: BudgetData[];
  budgetLoading: boolean;
  budgetError: Error | unknown | null;
  capacityTotals: TeamCapacityTotals;
  capacityError: Error | unknown | null;
  capacityLoading: boolean;
  overloadedMembers: TeamCapacityRow[];
}

export function PortfolioFinanceSection({
  totalPlan,
  totalFact,
  budgetUsed,
  budgetData,
  budgetLoading,
  budgetError,
  capacityTotals,
  capacityError,
  capacityLoading,
  overloadedMembers,
}: PortfolioFinanceSectionProps) {
  const { t, locale } = useLocale();

  return (
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
  );
}
