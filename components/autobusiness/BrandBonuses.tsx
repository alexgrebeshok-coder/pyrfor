"use client";

import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { brandBonuses } from "@/lib/autobusiness/demo-data";

import { useAutobusinessFormatting } from "./autobusiness-utils";

export function BrandBonuses() {
  const { formatMillions, t } = useAutobusinessFormatting();
  const maxBrandBonus = Math.max(...brandBonuses.map((entry) => entry.amount));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[var(--brand)]" />
          <CardTitle>{t("autobusiness.brands.title")}</CardTitle>
        </div>
        <CardDescription>{t("autobusiness.brands.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ClientChart className="space-y-4">
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
        </ClientChart>
      </CardContent>
    </Card>
  );
}
