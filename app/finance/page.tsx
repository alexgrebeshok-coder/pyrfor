"use client";

import React, { useMemo, useState } from "react";
import { Download, TrendingUp, TrendingDown, AlertTriangle, DollarSign } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { formatCurrency, safePercent } from "@/lib/utils";

type FinanceMetric = {
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  status: "success" | "warning" | "danger" | "info";
};

function FinanceMetricCard({ metric }: { metric: FinanceMetric }) {
  const statusColors = {
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-rose-600",
    info: "text-sky-600",
  };

  const trendColors = {
    up: "text-emerald-600",
    down: "text-rose-600",
    neutral: "text-slate-500",
  };

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
          {metric.label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <p className={`text-2xl font-semibold ${statusColors[metric.status]}`}>
              {metric.value}
            </p>
            {metric.trend && metric.trendValue && (
              <div className="mt-1 flex items-center gap-1">
                {metric.trend === "up" && <TrendingUp className="h-3 w-3" />}
                {metric.trend === "down" && <TrendingDown className="h-3 w-3" />}
                <span className={`text-xs ${trendColors[metric.trend]}`}>
                  {metric.trendValue}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FinancePage() {
  const { data: budgetData, isLoading } = useBudgetData();
  const [isExporting, setIsExporting] = useState(false);

  const metrics = useMemo<FinanceMetric[]>(() => {
    if (!budgetData || budgetData.length === 0) {
      return [
        { label: "Общий бюджет", value: "—", status: "info" },
        { label: "Потрачено", value: "—", status: "info" },
        { label: "CPI (индекс стоимости)", value: "—", status: "info" },
        { label: "Отклонение", value: "—", status: "info" },
      ];
    }

    const totalPlanned = budgetData.reduce((sum, p) => sum + (p.planned || 0), 0);
    const totalActual = budgetData.reduce((sum, p) => sum + (p.actual || 0), 0);
    const totalVariance = totalPlanned - totalActual;
    const cpi = totalActual > 0 ? totalPlanned / totalActual : 1;

    return [
      {
        label: "Общий бюджет",
        value: formatCurrency(totalPlanned, "RUB"),
        status: "info",
      },
      {
        label: "Потрачено",
        value: formatCurrency(totalActual, "RUB"),
        trend: totalVariance >= 0 ? "up" : "down",
        trendValue: `${safePercent(totalActual, totalPlanned)}% от плана`,
        status: totalVariance >= 0 ? "success" : "warning",
      },
      {
        label: "CPI (индекс стоимости)",
        value: cpi.toFixed(2),
        trend: cpi >= 1 ? "up" : "down",
        trendValue: cpi >= 1 ? "Эффективно" : "Перерасход",
        status: cpi >= 1 ? "success" : cpi >= 0.9 ? "warning" : "danger",
      },
      {
        label: "Отклонение",
        value: formatCurrency(Math.abs(totalVariance), "RUB"),
        trend: totalVariance >= 0 ? "up" : "down",
        trendValue: totalVariance >= 0 ? "В бюджете" : "Превышение",
        status: totalVariance >= 0 ? "success" : "danger",
      },
    ];
  }, [budgetData]);

  const handleExportEVM = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/finance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: budgetData }),
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const result = await response.json();
      
      if (result.downloadUrl) {
        // Trigger download
        window.open(result.downloadUrl, "_blank");
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Ошибка экспорта. Проверьте консоль для деталей.");
    } finally {
      setIsExporting(false);
    }
  };

  const projectsAtRisk = useMemo(() => {
    if (!budgetData) return [];
    return budgetData.filter((p) => p.variancePercent < -10);
  }, [budgetData]);

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="finance-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            Финансовый cockpit
          </h1>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Бюджет, прогнозы, EVM-метрики и экспорт
          </p>
        </div>
        <Button
          onClick={handleExportEVM}
          disabled={isExporting || isLoading}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          {isExporting ? "Экспорт..." : "Экспорт EVM в Excel"}
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <FinanceMetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {/* Projects at Risk */}
      {projectsAtRisk.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-lg">Проекты с перерасходом</CardTitle>
            </div>
            <CardDescription>
              {projectsAtRisk.length} проектов имеют CPI ниже 0.9
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectsAtRisk.slice(0, 5).map((item) => {
                return (
                  <div key={item.project} className="flex items-center justify-between p-3 bg-white/50 rounded-lg">
                    <div>
                      <p className="font-medium text-[var(--ink)]">{item.project}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        План: {formatCurrency(item.planned, "RUB")} · 
                        Факт: {formatCurrency(item.actual, "RUB")}
                      </p>
                    </div>
                    <Badge variant="danger">
                      {item.variancePercent.toFixed(1)}%
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Budget Distribution */}
      {budgetData && budgetData.length > 0 && (
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Распределение бюджета
            </CardTitle>
            <CardDescription>
              Бюджет и фактические расходы по проектам
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {budgetData.slice(0, 10).map((item) => {
                const usage = item.planned > 0 
                  ? safePercent(item.actual, item.planned) 
                  : 0;
                const isOverBudget = usage > 100;
                
                return (
                  <div key={item.project} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-[var(--ink)]">
                        {item.project}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--ink-muted)]">
                          {usage}% использовано
                        </span>
                        {isOverBudget && (
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                        )}
                      </div>
                    </div>
                    <Progress 
                      value={Math.min(usage, 100)} 
                      className="h-2"
                    />
                    <div className="flex justify-between text-xs text-[var(--ink-muted)]">
                      <span>Факт: {formatCurrency(item.actual, "RUB")}</span>
                      <span>План: {formatCurrency(item.planned, "RUB")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && (!budgetData || budgetData.length === 0) && (
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardContent className="py-12 text-center">
            <DollarSign className="h-12 w-12 mx-auto text-[var(--ink-muted)] opacity-50" />
            <p className="mt-4 text-[var(--ink-muted)]">
              Нет данных о бюджете. Добавьте проекты с бюджетом.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
