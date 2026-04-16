"use client";

import { Car } from "lucide-react";

import { BrandBonuses } from "@/components/autobusiness/BrandBonuses";
import { CashFlowChart } from "@/components/autobusiness/CashFlowChart";
import { KpiCards } from "@/components/autobusiness/KpiCards";
import { OrganizationCards } from "@/components/autobusiness/OrganizationCards";
import { PnlSummary } from "@/components/autobusiness/PnlSummary";
import { TopArticlesTable } from "@/components/autobusiness/TopArticlesTable";
import { TopDebtors } from "@/components/autobusiness/TopDebtors";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/contexts/locale-context";

export default function AutoBusinessPage() {
  const { t } = useLocale();

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

      <KpiCards />

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <CashFlowChart />
        <TopArticlesTable />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <OrganizationCards />
        <PnlSummary />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <BrandBonuses />
        <TopDebtors />
      </section>
    </div>
  );
}
