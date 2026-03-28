"use client";

import { TrendingUp, TrendingDown, Minus, DollarSign, Clock, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLocale } from "@/contexts/locale-context";
import type { EVMMetrics } from "@/lib/types";

interface EVMMetricsCardProps {
  metrics: EVMMetrics | null;
  budget: { planned: number; actual: number };
  isLoading?: boolean;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

function CPIIndicator({ cpi }: { cpi: number }) {
  const { t } = useLocale();
  
  let tone: "success" | "warning" | "danger" = "success";
  let trend: "up" | "down" | "neutral" = "neutral";
  
  if (cpi >= 1.0) {
    tone = "success";
    trend = "up";
  } else if (cpi >= 0.9) {
    tone = "warning";
    trend = "neutral";
  } else {
    tone = "danger";
    trend = "down";
  }

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={tone}>
        <TrendIcon className="mr-1 h-3 w-3" />
        {cpi.toFixed(2)}
      </Badge>
      <span className="text-xs text-[var(--ink-soft)]">
        {cpi >= 1.0 ? t("dashboard.evm.underBudget") : cpi >= 0.9 ? t("dashboard.evm.onBudget") : t("dashboard.evm.overBudget")}
      </span>
    </div>
  );
}

function SPIIndicator({ spi }: { spi: number }) {
  const { t } = useLocale();
  
  let tone: "success" | "warning" | "danger" = "success";
  let trend: "up" | "down" | "neutral" = "neutral";
  
  if (spi >= 1.0) {
    tone = "success";
    trend = "up";
  } else if (spi >= 0.9) {
    tone = "warning";
    trend = "neutral";
  } else {
    tone = "danger";
    trend = "down";
  }

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={tone}>
        <TrendIcon className="mr-1 h-3 w-3" />
        {spi.toFixed(2)}
      </Badge>
      <span className="text-xs text-[var(--ink-soft)]">
        {spi >= 1.0 ? t("dashboard.evm.aheadSchedule") : spi >= 0.9 ? t("dashboard.evm.onSchedule") : t("dashboard.evm.behindSchedule")}
      </span>
    </div>
  );
}

export function EVMMetricsCard({ metrics, budget, isLoading }: EVMMetricsCardProps) {
  const { t } = useLocale();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {t("dashboard.evm.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-[10px] bg-[var(--panel-soft)]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!metrics) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {t("dashboard.evm.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Earned Value */}
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[var(--brand)]" />
              <span className="text-sm font-medium text-[var(--ink-soft)]">
                {t("dashboard.evm.earnedValue")}
              </span>
            </div>
            <span className="font-heading text-lg font-semibold text-[var(--ink)]">
              {formatCurrency(metrics.ev)}
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
              <span>{t("dashboard.evm.progress")}</span>
              <span>{metrics.percentComplete}%</span>
            </div>
            <Progress value={metrics.percentComplete} className="mt-1.5 h-2" />
          </div>
        </div>

        {/* Cost Performance Index (CPI) */}
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--ink-soft)]">
              {t("dashboard.evm.cpi")}
            </span>
            <CPIIndicator cpi={metrics.cpi} />
          </div>
          <div className="mt-2 text-xs text-[var(--ink-soft)]">
            {t("dashboard.evm.cpiDescription")}
          </div>
        </div>

        {/* Schedule Performance Index (SPI) */}
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--ink-soft)]">
              {t("dashboard.evm.spi")}
            </span>
            <SPIIndicator spi={metrics.spi} />
          </div>
          <div className="mt-2 text-xs text-[var(--ink-soft)]">
            {t("dashboard.evm.spiDescription")}
          </div>
        </div>

        {/* Estimate at Completion (EAC) */}
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--brand)]" />
              <span className="text-sm font-medium text-[var(--ink-soft)]">
                {t("dashboard.evm.eac")}
              </span>
            </div>
            <div className="text-right">
              <span className="font-heading text-lg font-semibold text-[var(--ink)]">
                {formatCurrency(metrics.eac)}
              </span>
              <div className="mt-1 text-xs text-[var(--ink-soft)]">
                {t("dashboard.evm.budget")}: {formatCurrency(budget.planned)}
              </div>
            </div>
          </div>
          {metrics.vac !== 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant={metrics.vac > 0 ? "success" : "danger"}>
                {metrics.vac > 0 ? "+" : ""}
                {formatCurrency(metrics.vac)}
              </Badge>
              <span className="text-xs text-[var(--ink-soft)]">
                {t("dashboard.evm.variance")}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
