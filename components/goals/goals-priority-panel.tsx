import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";

import type { GoalsPriorityPanelProps } from "@/components/goals/goals-page.types";

export function GoalsPriorityPanel({
  budgetError,
  budgetLoading,
  budgetUsed,
  capacityError,
  capacityLoading,
  capacityUtilization,
  objectiveSummary,
  planFactCpi,
  priorityCluster,
  scenarioOutlook,
}: GoalsPriorityPanelProps) {
  return (
    <section className="grid gap-3" data-testid="goal-priority">
      <Card className="min-w-0">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base tracking-[-0.06em]">
                Приоритет внимания
              </CardTitle>
              <CardDescription>
                Один экран, который показывает, какой контур требует решения первым и
                как он связан с целями, бюджетом и ёмкостью команды.
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
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  Самый срочный контур
                </p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                  {priorityCluster.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                  {priorityCluster.nextAction}
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    Покрытие целей
                  </p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.05em] text-[var(--ink)]">
                    {objectiveSummary.coveragePercent}%
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {objectiveSummary.coveredProjects} из {objectiveSummary.totalProjects} проектов
                    с целями
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    Бюджетный прогноз
                  </p>
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
                    {planFactCpi
                      ? `Факт/план ${budgetUsed}% · CPI ${planFactCpi.toFixed(2)} · нейтральный сценарий CPI 1.00`
                      : `Факт/план ${budgetUsed}% · нейтральный сценарий CPI 1.00`}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    Загрузка команды
                  </p>
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
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Почему это важно
                </p>
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
              Пока данных недостаточно, чтобы выделить приоритет. Как только появятся
              цели, проекты и сигналы, здесь отобразится первый управленческий фокус.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
