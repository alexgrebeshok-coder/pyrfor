"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { TeamPerformanceLazy } from "@/components/analytics/team-performance-lazy";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { useRiskData } from "@/lib/hooks/use-risk-data";
import { ChartErrorBoundary } from "@/components/analytics/chart-error-boundary";

// Lazy load chart components (recharts ~4MB)
const BudgetChart = dynamic(
  () => import("@/components/analytics/budget-chart").then(m => ({ default: m.BudgetChart })),
  { ssr: false, loading: () => <div className="animate-pulse bg-[var(--surface-panel)] rounded-lg h-48" /> }
);
const RiskDistribution = dynamic(
  () => import("@/components/analytics/risk-distribution").then(m => ({ default: m.RiskDistribution })),
  { ssr: false, loading: () => <div className="animate-pulse bg-[var(--surface-panel)] rounded-lg h-48" /> }
);
const RiskMatrix = dynamic(
  () => import("@/components/analytics/risk-matrix").then((m) => ({ default: m.RiskMatrix })),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-[var(--surface-panel)] rounded-lg h-[420px]" />
    ),
  }
);

// Lazy load ProjectTimeline component (gantt-task-react ~100-150KB)
const ProjectTimeline = dynamic(
  () => import("@/components/analytics/project-timeline").then((mod) => ({
    default: mod.ProjectTimeline,
  })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64 bg-[var(--surface-panel)] rounded-lg">
        <div className="animate-pulse text-[var(--ink-muted)]">Загрузка таймлайна...</div>
      </div>
    ),
  }
);

export default function AnalyticsPage() {
  const { data: budgetData, isLoading: budgetLoading, error: budgetError } = useBudgetData();
  const { data: riskData, isLoading: riskLoading, error: riskError } = useRiskData();

  return (
    <div className="container mx-auto py-6" data-testid="analytics-page">
      {/* Live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {budgetLoading || riskLoading
          ? "Загрузка данных аналитики..."
          : `Загружено данных: бюджет ${budgetData?.length || 0} проектов, риски ${riskData?.length || 0} элементов`}
      </div>

      <div className="mb-4">
        <h1 className="text-lg font-bold">Аналитика</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Эффективность проектов и метрики команды
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-3">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="timeline">Таймлайн</TabsTrigger>
          <TabsTrigger value="budget">Бюджет</TabsTrigger>
          <TabsTrigger value="risk">Риски</TabsTrigger>
          <TabsTrigger value="team">Команда</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <AnalyticsDashboard />
        </TabsContent>

        <TabsContent value="timeline">
          <ChartErrorBoundary>
            <ProjectTimeline />
          </ChartErrorBoundary>
        </TabsContent>

        <TabsContent value="budget">
          {budgetError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="text-red-800 dark:text-red-200 text-sm">
                ⚠️ Ошибка загрузки данных бюджета. Попробуйте обновить страницу.
              </p>
              <p className="text-red-600 dark:text-red-300 text-xs mt-1">
                {budgetError.message}
              </p>
            </div>
          )}
          <ChartErrorBoundary>
            <BudgetChart data={budgetData} loading={budgetLoading} />
          </ChartErrorBoundary>
        </TabsContent>

        <TabsContent value="risk">
          {riskError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="text-red-800 dark:text-red-200 text-sm">
                ⚠️ Ошибка загрузки данных рисков. Попробуйте обновить страницу.
              </p>
              <p className="text-red-600 dark:text-red-300 text-xs mt-1">
                {riskError.message}
              </p>
            </div>
          )}
          <div className="space-y-6">
            <RiskMatrix data={riskData} loading={riskLoading} />
            <ChartErrorBoundary>
              <RiskDistribution data={riskData} loading={riskLoading} />
            </ChartErrorBoundary>
          </div>
        </TabsContent>

        <TabsContent value="team">
          <ChartErrorBoundary>
            <TeamPerformanceLazy />
          </ChartErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
