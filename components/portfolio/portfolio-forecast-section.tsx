"use client";

import { AlertTriangle, Users, Wallet } from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import type { PortfolioFinanceOutlook, PortfolioCapacityOutlook } from "@/lib/portfolio/portfolio-outlook";
import { MiniSignalCard } from "./portfolio-cards";

export interface PortfolioForecastSectionProps {
  financeOutlook: PortfolioFinanceOutlook;
  capacityOutlook: PortfolioCapacityOutlook;
}

export function PortfolioForecastSection({ financeOutlook, capacityOutlook }: PortfolioForecastSectionProps) {
  const { locale } = useLocale();

  return (
    <section className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]" data-testid="portfolio-forecast">
      <Card className="min-w-0" data-testid="portfolio-forecast-finance">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-[var(--brand)]" />
            Прогноз бюджета
          </CardTitle>
          <CardDescription>
            Показываем, к чему ведёт текущий CPI и сколько денег может потребоваться до завершения портфеля.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">План</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCurrency(financeOutlook.plannedBudget, "RUB", locale)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Факт</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCurrency(financeOutlook.actualSpend, "RUB", locale)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Прогноз</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCurrency(financeOutlook.forecastAtCompletion, "RUB", locale)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Отклонение</p>
              <p className={cn(
                "mt-1 text-lg font-semibold tracking-[-0.05em]",
                financeOutlook.tone === "danger" && "text-rose-600",
                financeOutlook.tone === "warning" && "text-amber-600",
                financeOutlook.tone === "success" && "text-emerald-600"
              )}>
                {financeOutlook.forecastVariance >= 0 ? "+" : ""}
                {formatCurrency(financeOutlook.forecastVariance, "RUB", locale)}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Следующий шаг</p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                  {financeOutlook.tone === "danger"
                    ? "Проверить ближайшие расходы и переподтвердить forecast до конца периода."
                    : financeOutlook.tone === "warning"
                      ? "Следить за forecast и подтвердить, что отклонение остаётся управляемым."
                      : "Forecast стабилен. Держим курс и продолжаем следить за фактом."}
                </p>
              </div>
              <Badge variant={financeOutlook.tone === "danger" ? "danger" : financeOutlook.tone === "warning" ? "warning" : "success"}>
                {financeOutlook.currentUsagePercent}% из плана
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущий расход</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                  {financeOutlook.currentUsagePercent}%
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Осталось</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                  {formatCurrency(financeOutlook.remainingBudget, "RUB", locale)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Прогноз от плана</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                  {financeOutlook.forecastUsagePercent}%
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0" data-testid="portfolio-forecast-capacity">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-[var(--brand)]" />
            Прогноз по capacity
          </CardTitle>
          <CardDescription>
            Смотрим, где уже появляется перегрузка и сколько запаса осталось на следующий цикл.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniSignalCard
              icon={Users}
              label="Занято"
              value={`${capacityOutlook.utilizationPercent}%`}
              variant={capacityOutlook.tone === "danger" ? "danger" : capacityOutlook.tone === "warning" ? "warning" : "success"}
              description="Доля capacity, которая уже использована."
            />
            <MiniSignalCard
              icon={AlertTriangle}
              label="Перегружено"
              value={String(capacityOutlook.overloadedMembersCount)}
              variant={capacityOutlook.overloadedMembersCount > 0 ? "danger" : "success"}
              description="Сколько людей уже выше безопасного порога."
            />
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Следующий шаг</p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                  {capacityOutlook.tone === "danger"
                    ? "Снизить перегрузку и перераспределить assignments до следующего цикла."
                    : capacityOutlook.tone === "warning"
                      ? "Почти достигли безопасного порога. Лучше заранее перераспределить часть задач."
                      : "Запас capacity есть. Можно брать следующий поток работы без перегруза."}
                </p>
              </div>
              <Badge variant={capacityOutlook.tone === "danger" ? "danger" : capacityOutlook.tone === "warning" ? "warning" : "success"}>
                {capacityOutlook.availableCapacity} свободно
              </Badge>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  capacityOutlook.tone === "danger" && "bg-rose-500",
                  capacityOutlook.tone === "warning" && "bg-amber-500",
                  capacityOutlook.tone === "success" && "bg-emerald-500"
                )}
                style={{ width: `${Math.min(capacityOutlook.utilizationPercent, 100)}%` }}
              />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Всего</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.totalCapacity}</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Занято</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.allocatedCapacity}</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Перегрузка</p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">{capacityOutlook.overloadedCapacity}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
