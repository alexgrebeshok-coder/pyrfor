"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { kpiCards } from "@/lib/autobusiness/demo-data";

import { getTrendIcon, getTrendVariant, useAutobusinessFormatting } from "./autobusiness-utils";

const trendLabelKeys = {
  up: "autobusiness.trend.up",
  down: "autobusiness.trend.down",
  stable: "autobusiness.trend.stable",
} as const;

export function KpiCards() {
  const { normalizeKpiValue, t } = useAutobusinessFormatting();

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {kpiCards.map((card) => {
        const TrendIcon = getTrendIcon(card.trend);
        const normalized = normalizeKpiValue(card.value);

        return (
          <Card key={card.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardDescription className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {t(card.labelKey)}
                  </CardDescription>
                  <CardTitle className="mt-3 text-3xl font-semibold" title={normalized.title}>
                    {normalized.displayValue}
                  </CardTitle>
                </div>
                <Badge variant={getTrendVariant(card.trend)}>
                  <TrendIcon className="mr-1 h-3.5 w-3.5" />
                  {t(trendLabelKeys[card.trend])}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-[var(--ink-muted)]">
                {normalized.unit || t("autobusiness.kpi.shareLabel")}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
