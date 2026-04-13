"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Car,
  Minus,
  TrendingUp,
} from "lucide-react";

import {
  brandBonuses,
  cashFlowByYear,
  cashFlowMonthly2025,
  kpiCards,
  orgBreakdown,
  pnlSummary,
  topArticles,
} from "@/lib/autobusiness/demo-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { useLocale } from "@/contexts/locale-context";
import { formatCurrency } from "@/lib/utils";

const localeMap = {
  ru: "ru-RU",
  en: "en-US",
  zh: "zh-CN",
} as const;

function getTrendVariant(trend: string): "success" | "danger" | "neutral" {
  switch (trend) {
    case "up":
      return "success";
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

function getTrendIcon(trend: string) {
  switch (trend) {
    case "up":
      return ArrowUpRight;
    case "down":
      return ArrowDownRight;
    default:
      return Minus;
  }
}

export default function AutoBusinessPage() {
  const { locale, t } = useLocale();
  const numberLocale = localeMap[locale] ?? "ru-RU";
  const trendLabelKeys = {
    up: "autobusiness.trend.up",
    down: "autobusiness.trend.down",
    stable: "autobusiness.trend.stable",
  } as const;
  const revenueLabelKeys = {
    sto: "autobusiness.revenue.sto",
    parts: "autobusiness.revenue.parts",
    bonuses: "autobusiness.revenue.bonuses",
    other: "autobusiness.revenue.other",
  } as const;

  const millionFormatter = new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });

  const percentFormatter = new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });

  const formatMillions = (value: number) => `${millionFormatter.format(value)} ${t("autobusiness.unit")}`;
  const formatSignedMillions = (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "-" : ""}${millionFormatter.format(Math.abs(value))} ${t("autobusiness.unit")}`;
  const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;
  const formatFullRubles = (value: number) => formatCurrency(value * 1_000_000, "RUB", locale);

  const normalizeKpiValue = (value: string) => {
    if (value.includes("млрд")) {
      const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
      const signedValue = value.trim().startsWith("-") ? -parsed * 1000 : parsed * 1000;

      return {
        displayValue: `${value.trim().startsWith("+") ? "+" : signedValue < 0 ? "-" : ""}${millionFormatter.format(Math.abs(signedValue))}`,
        unit: t("autobusiness.unit"),
        title: formatCurrency(signedValue * 1_000_000, "RUB", locale),
      };
    }

    if (value.includes("%")) {
      return {
        displayValue: value,
        unit: "",
      };
    }

    return {
      displayValue: value,
      unit: "",
    };
  };

  const maxCashFlowValue = Math.max(
    ...cashFlowMonthly2025.flatMap((entry) => [entry.inflow, entry.outflow])
  );
  const maxBrandBonus = Math.max(...brandBonuses.map((entry) => entry.amount));
  const totalRevenue = Object.values(pnlSummary.revenue).reduce((sum, value) => sum + value, 0);
  const revenueRows = [
    { key: "sto", amount: pnlSummary.revenue.sto, tone: "bg-sky-500/80" },
    { key: "parts", amount: pnlSummary.revenue.parts, tone: "bg-cyan-500/80" },
    { key: "bonuses", amount: pnlSummary.revenue.bonuses, tone: "bg-emerald-500/80" },
    { key: "other", amount: pnlSummary.revenue.other, tone: "bg-amber-500/80" },
  ] as const;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Badge className="w-fit" variant="info">
          {t("autobusiness.badge")}
        </Badge>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Car className="h-5 w-5 text-[var(--brand)]" />
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
                {t("autobusiness.title")}
              </h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
              {t("autobusiness.subtitle")}
            </p>
          </div>
          <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
            {t("autobusiness.unit")}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const trendIcon = getTrendIcon(card.trend);
          const TrendIcon = trendIcon;
          const normalized = normalizeKpiValue(card.value);

          return (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardDescription className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      {card.label}
                    </CardDescription>
                    <CardTitle className="mt-3 text-3xl font-semibold" title={normalized.title}>
                      {normalized.displayValue}
                    </CardTitle>
                  </div>
                  <Badge variant={getTrendVariant(card.trend)}>
                    <TrendIcon className="mr-1 h-3.5 w-3.5" />
                    {t(trendLabelKeys[card.trend as keyof typeof trendLabelKeys] ?? "autobusiness.trend.stable")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {normalized.unit ? (
                  <p className="text-xs text-[var(--ink-muted)]">{normalized.unit}</p>
                ) : (
                  <p className="text-xs text-[var(--ink-muted)]">{t("autobusiness.kpi.shareLabel")}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("autobusiness.cashFlow.monthlyTitle")}</CardTitle>
            <CardDescription>{t("autobusiness.cashFlow.monthlyDescription")}</CardDescription>
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
                      {entry.balance >= 0 ? t("autobusiness.balancePositive") : t("autobusiness.balanceNegative")}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[var(--ink-muted)]">{t("autobusiness.inflow")}</p>
                      <p className="mt-1 font-medium text-[var(--ink)]">{formatMillions(entry.inflow)}</p>
                    </div>
                    <div>
                      <p className="text-[var(--ink-muted)]">{t("autobusiness.outflow")}</p>
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
                  {t("autobusiness.inflow")}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  {t("autobusiness.outflow")}
                </div>
              </div>

              <ClientChart className="h-[280px]">
                <div className="flex h-full items-end gap-2">
                  {cashFlowMonthly2025.map((entry) => (
                    <div className="flex min-w-0 flex-1 flex-col items-center gap-3" key={entry.month}>
                      <div className="flex h-full w-full items-end justify-center gap-1.5">
                        <div
                          aria-label={`${entry.month} ${t("autobusiness.inflow")} ${formatFullRubles(entry.inflow)}`}
                          className="w-full max-w-4 rounded-t-full bg-emerald-400/90 shadow-[0_0_18px_rgba(52,211,153,0.25)]"
                          style={{ height: `${Math.max((entry.inflow / maxCashFlowValue) * 100, 8)}%` }}
                          title={formatFullRubles(entry.inflow)}
                        />
                        <div
                          aria-label={`${entry.month} ${t("autobusiness.outflow")} ${formatFullRubles(entry.outflow)}`}
                          className="w-full max-w-4 rounded-t-full bg-rose-400/90 shadow-[0_0_18px_rgba(251,113,133,0.22)]"
                          style={{ height: `${Math.max((entry.outflow / maxCashFlowValue) * 100, 8)}%` }}
                          title={formatFullRubles(entry.outflow)}
                        />
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-xs font-medium text-[var(--ink)]">{entry.month}</p>
                        <p className="text-[11px] text-[var(--ink-muted)]">
                          {formatSignedMillions(entry.inflow - entry.outflow)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ClientChart>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("autobusiness.topArticles.title")}</CardTitle>
            <CardDescription>{t("autobusiness.topArticles.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
              <table className="min-w-full divide-y divide-[color:var(--line)] text-sm">
                <thead className="bg-[color:var(--panel-soft)]/65">
                  <tr className="text-left text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    <th className="px-3 py-3 font-medium">{t("autobusiness.table.article")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("autobusiness.inflow")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("autobusiness.outflow")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--line)] bg-[color:var(--surface-panel)]/35">
                  {topArticles.map((entry) => (
                    <tr key={entry.name}>
                      <td className="px-3 py-3 font-medium text-[var(--ink)]">{entry.name}</td>
                      <td className="px-3 py-3 text-right text-[var(--ink-muted)]">
                        {entry.inflow > 0 ? formatMillions(entry.inflow) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-[var(--ink-muted)]">
                        {entry.outflow > 0 ? formatMillions(entry.outflow) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("autobusiness.orgBreakdown.title")}</CardTitle>
            <CardDescription>{t("autobusiness.orgBreakdown.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {orgBreakdown.map((entry) => (
                <div
                  className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-soft)]/55 p-4"
                  key={entry.name}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[var(--ink-muted)]">
                        <Building2 className="h-4 w-4" />
                        <p className="text-sm font-medium text-[var(--ink)]">{entry.name}</p>
                      </div>
                      <p className="text-2xl font-semibold text-[var(--ink)]">
                        {formatSignedMillions(entry.balance)}
                      </p>
                    </div>
                    <Badge variant={entry.margin >= 0 ? "success" : "danger"}>
                      {formatPercent(entry.margin)}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-[var(--ink-muted)]">
                    <span>{t("autobusiness.orgBreakdown.balance")}</span>
                    <span>{t("autobusiness.orgBreakdown.margin")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("autobusiness.pnl.title")}</CardTitle>
            <CardDescription>{t("autobusiness.pnl.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-4">
              {revenueRows.map((entry) => (
                <div key={entry.key}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--ink)]">{t(revenueLabelKeys[entry.key])}</span>
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
      </section>

      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--brand)]" />
              <CardTitle>{t("autobusiness.brandBonuses.title")}</CardTitle>
            </div>
            <CardDescription>{t("autobusiness.brandBonuses.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {brandBonuses.map((entry, index) => (
                <div key={entry.brand}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-[var(--ink)]">{entry.brand}</span>
                    <span className="text-[var(--ink-muted)]">{formatMillions(entry.amount)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400"
                      style={{
                        width: `${(entry.amount / maxBrandBonus) * 100}%`,
                        opacity: 1 - index * 0.08,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
