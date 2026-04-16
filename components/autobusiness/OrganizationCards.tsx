"use client";

import { Building2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orgBreakdown } from "@/lib/autobusiness/demo-data";

import { useAutobusinessFormatting } from "./autobusiness-utils";

export function OrganizationCards() {
  const { formatPercent, formatSignedMillions, t } = useAutobusinessFormatting();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("autobusiness.orgs.title")}</CardTitle>
        <CardDescription>{t("autobusiness.orgs.subtitle")}</CardDescription>
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
                <span>{t("autobusiness.orgs.balance")}</span>
                <span>{t("autobusiness.orgs.margin")}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
