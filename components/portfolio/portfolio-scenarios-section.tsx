"use client";

import { Users, Wallet } from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import type { PortfolioScenarioOutlook } from "@/lib/portfolio/portfolio-outlook";

export interface PortfolioScenariosSectionProps {
  scenarioOutlook: PortfolioScenarioOutlook;
}

export function PortfolioScenariosSection({ scenarioOutlook }: PortfolioScenariosSectionProps) {
  const { locale } = useLocale();

  return (
    <section className="grid gap-3 xl:grid-cols-2" data-testid="portfolio-scenarios">
      <Card className="min-w-0" data-testid="portfolio-scenario-finance">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-[var(--brand)]" />
            Сценарий бюджета
          </CardTitle>
          <CardDescription>
            Сравниваем текущий forecast с нейтральным сценарием, где CPI возвращается к 1.00.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                scenarioOutlook.finance.tone === "danger"
                  ? "danger"
                  : scenarioOutlook.finance.tone === "warning"
                    ? "warning"
                    : "success"
              }
            >
              CPI 1.00
            </Badge>
            <Badge variant="neutral">Нейтральный сценарий</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущий forecast</p>
                <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCurrency(scenarioOutlook.finance.baselineForecastAtCompletion, "RUB", locale)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">При CPI 1.00</p>
              <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCurrency(scenarioOutlook.finance.neutralForecastAtCompletion, "RUB", locale)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Разница</p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold tracking-[-0.05em]",
                  scenarioOutlook.finance.forecastDelta > 0 && "text-rose-600",
                  scenarioOutlook.finance.forecastDelta < 0 && "text-emerald-600"
                )}
              >
                {scenarioOutlook.finance.forecastDelta >= 0 ? "+" : ""}
                {formatCurrency(scenarioOutlook.finance.forecastDelta, "RUB", locale)}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Что это значит</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
              {scenarioOutlook.finance.forecastDelta > 0
                ? "Чтобы вернуться к нейтральному сценарию, нужно сократить перерасход и вернуть CPI к плановому уровню."
                : scenarioOutlook.finance.forecastDelta < 0
                  ? "Текущий forecast лучше нейтрального сценария. Можно удерживать дисциплину и не терять запас."
                  : "Текущий forecast уже совпадает с нейтральным сценарием. Дальше важна стабильность исполнения."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0" data-testid="portfolio-scenario-capacity">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-[var(--brand)]" />
            Сценарий загрузки
          </CardTitle>
          <CardDescription>
            Смотрим, сколько capacity нужно освободить, чтобы держать загрузку не выше 80%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                scenarioOutlook.capacity.tone === "danger"
                  ? "danger"
                  : scenarioOutlook.capacity.tone === "warning"
                    ? "warning"
                    : "success"
              }
            >
              80% загрузка
            </Badge>
            <Badge variant="neutral">
              Цель {scenarioOutlook.capacity.targetAllocatedCapacity} единиц
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Текущая загрузка</p>
              <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {scenarioOutlook.capacity.currentUtilizationPercent}%
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Цель</p>
              <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {scenarioOutlook.capacity.targetUtilizationPercent}%
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {scenarioOutlook.capacity.utilizationGapCapacity > 0 ? "Нужно освободить" : "Запас до цели"}
              </p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold tracking-[-0.05em]",
                  scenarioOutlook.capacity.utilizationGapCapacity > 0 && "text-rose-600",
                  scenarioOutlook.capacity.utilizationGapCapacity === 0 && "text-emerald-600",
                  scenarioOutlook.capacity.utilizationGapCapacity < 0 && "text-sky-600"
                )}
              >
                {scenarioOutlook.capacity.utilizationGapCapacity > 0
                  ? `${scenarioOutlook.capacity.releaseNeededToTarget} ед.`
                  : `${scenarioOutlook.capacity.spareCapacityToTarget} ед.`}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Что это значит</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
              {scenarioOutlook.capacity.utilizationGapCapacity > 0
                ? "Чтобы не выходить за безопасную загрузку, нужно освободить часть capacity или перенести assignments."
                : scenarioOutlook.capacity.utilizationGapCapacity < 0
                  ? "Есть запас до безопасной загрузки. Можно брать новый поток работы без перегруза."
                  : "Загрузка уже на целевом уровне. Это хороший момент удержать текущий ритм."}
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
