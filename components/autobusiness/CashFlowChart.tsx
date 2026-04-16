"use client";

import { cashFlowByYear, cashFlowMonthly2025 } from "@/lib/autobusiness/demo-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";

import { useAutobusinessFormatting } from "./autobusiness-utils";

export function CashFlowChart() {
  const { formatFullRubles, formatMillions, formatMonth, formatSignedMillions, t } =
    useAutobusinessFormatting();
  const maxCashFlowValue = Math.max(
    ...cashFlowMonthly2025.flatMap((entry) => [entry.inflow, entry.outflow])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("autobusiness.dds.title")}</CardTitle>
        <CardDescription>{t("autobusiness.dds.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          {cashFlowByYear.map((entry) => (
            <div
              className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-soft)]/55 p-4"
              key={entry.year}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {entry.year}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-[var(--ink)]">
                    {formatSignedMillions(entry.balance)}
                  </p>
                </div>
                <Badge variant={entry.balance >= 0 ? "success" : "danger"}>
                  {entry.balance >= 0
                    ? t("autobusiness.dds.positiveBalance")
                    : t("autobusiness.dds.negativeBalance")}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[var(--ink-muted)]">{t("autobusiness.dds.inflow")}</p>
                  <p className="mt-1 font-medium text-[var(--ink)]">{formatMillions(entry.inflow)}</p>
                </div>
                <div>
                  <p className="text-[var(--ink-muted)]">{t("autobusiness.dds.outflow")}</p>
                  <p className="mt-1 font-medium text-[var(--ink)]">{formatMillions(entry.outflow)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-panel)]/40 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              {t("autobusiness.dds.inflow")}
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              {t("autobusiness.dds.outflow")}
            </div>
          </div>

          <ClientChart className="h-[280px]">
            <div className="flex h-full items-end gap-2">
              {cashFlowMonthly2025.map((entry) => {
                const monthLabel = formatMonth(entry.month);

                return (
                  <div className="flex min-w-0 flex-1 flex-col items-center gap-3" key={entry.month}>
                    <div className="flex h-full w-full items-end justify-center gap-1.5">
                      <div
                        aria-label={`${monthLabel} ${t("autobusiness.dds.inflow")} ${formatFullRubles(entry.inflow)}`}
                        className="w-full max-w-4 rounded-t-full bg-emerald-400/90 shadow-[0_0_18px_rgba(52,211,153,0.25)]"
                        style={{ height: `${Math.max((entry.inflow / maxCashFlowValue) * 100, 8)}%` }}
                        title={formatFullRubles(entry.inflow)}
                      />
                      <div
                        aria-label={`${monthLabel} ${t("autobusiness.dds.outflow")} ${formatFullRubles(entry.outflow)}`}
                        className="w-full max-w-4 rounded-t-full bg-rose-400/90 shadow-[0_0_18px_rgba(251,113,133,0.22)]"
                        style={{ height: `${Math.max((entry.outflow / maxCashFlowValue) * 100, 8)}%` }}
                        title={formatFullRubles(entry.outflow)}
                      />
                    </div>
                    <div className="space-y-1 text-center">
                      <p className="text-xs font-medium text-[var(--ink)]">{monthLabel}</p>
                      <p className="text-[11px] text-[var(--ink-muted)]">
                        {formatSignedMillions(entry.inflow - entry.outflow)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ClientChart>
        </div>
      </CardContent>
    </Card>
  );
}
