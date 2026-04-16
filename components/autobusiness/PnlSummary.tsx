"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pnlSummary } from "@/lib/autobusiness/demo-data";

import { useAutobusinessFormatting } from "./autobusiness-utils";

const revenueRows = [
  { key: "sto", amount: pnlSummary.revenue.sto, tone: "bg-sky-500/80", labelKey: "autobusiness.pnl.sto" },
  { key: "parts", amount: pnlSummary.revenue.parts, tone: "bg-cyan-500/80", labelKey: "autobusiness.pnl.parts" },
  {
    key: "bonuses",
    amount: pnlSummary.revenue.bonuses,
    tone: "bg-emerald-500/80",
    labelKey: "autobusiness.pnl.bonuses",
  },
  { key: "other", amount: pnlSummary.revenue.other, tone: "bg-amber-500/80", labelKey: "autobusiness.pnl.other" },
] as const;

export function PnlSummary() {
  const { formatMillions, formatSignedMillions, t } = useAutobusinessFormatting();
  const totalRevenue = Object.values(pnlSummary.revenue).reduce((sum, value) => sum + value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("autobusiness.pnl.title")}</CardTitle>
        <CardDescription>{t("autobusiness.pnl.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-4">
          {revenueRows.map((entry) => (
            <div key={entry.key}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--ink)]">{t(entry.labelKey)}</span>
                <span className="font-medium text-[var(--ink-muted)]">{formatMillions(entry.amount)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
                <div
                  className={`h-full rounded-full ${entry.tone}`}
                  style={{ width: `${(entry.amount / totalRevenue) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-soft)]/55 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {t("autobusiness.pnl.cogs")}
            </p>
            <p className="mt-2 text-xl font-semibold text-rose-400">
              {formatSignedMillions(pnlSummary.cogs)}
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-soft)]/55 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {t("autobusiness.pnl.grossProfit")}
            </p>
            <p className="mt-2 text-xl font-semibold text-emerald-400">
              {formatSignedMillions(pnlSummary.grossProfit)}
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-soft)]/55 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {t("autobusiness.pnl.netProfit")}
            </p>
            <p className="mt-2 text-xl font-semibold text-emerald-300">
              {formatSignedMillions(pnlSummary.netProfit)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
