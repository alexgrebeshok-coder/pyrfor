"use client";

import { AlertTriangle, Clock3, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { topDebtors } from "@/lib/autobusiness/demo-data";
import { cn } from "@/lib/utils";

import { useAutobusinessFormatting } from "./autobusiness-utils";

const severityMeta = {
  critical: {
    badgeKey: "autobusiness.debtors.critical",
    variant: "danger",
    cardClassName:
      "border-rose-300/60 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-950/10",
  },
  watch: {
    badgeKey: "autobusiness.debtors.watch",
    variant: "warning",
    cardClassName:
      "border-amber-300/60 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-950/10",
  },
} as const;

export function TopDebtors() {
  const { formatMillions, t } = useAutobusinessFormatting();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("autobusiness.debtors.title")}</CardTitle>
        <CardDescription>{t("autobusiness.debtors.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {topDebtors.map((debtor) => {
          const meta = severityMeta[debtor.severity];

          return (
            <div
              className={cn("rounded-2xl border p-4", meta.cardClassName)}
              key={`${debtor.name}-${debtor.overdueDays}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={cn(
                        "h-4 w-4 shrink-0",
                        debtor.severity === "critical" ? "text-rose-500" : "text-amber-500"
                      )}
                    />
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{debtor.name}</p>
                  </div>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">{t(debtor.noteKey)}</p>
                </div>
                <Badge variant={meta.variant}>{t(meta.badgeKey)}</Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/50 px-3 py-2 dark:bg-white/5">
                  <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t("autobusiness.debtors.overdueDays")}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                    {debtor.overdueDays} {t("autobusiness.debtors.days")}
                  </p>
                </div>
                <div className="rounded-xl bg-white/50 px-3 py-2 dark:bg-white/5">
                  <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <Wallet className="h-3.5 w-3.5" />
                    {t("autobusiness.debtors.exposure")}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                    {formatMillions(debtor.amount)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/50 px-3 py-2 dark:bg-white/5">
                  <div className="text-xs text-[var(--ink-muted)]">{t("autobusiness.debtors.manager")}</div>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{t(debtor.managerKey)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
