"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { topArticles } from "@/lib/autobusiness/demo-data";

import { useAutobusinessFormatting } from "./autobusiness-utils";

export function TopArticlesTable() {
  const { formatMillions, t } = useAutobusinessFormatting();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("autobusiness.dds.articlesTitle")}</CardTitle>
        <CardDescription>{t("autobusiness.dds.articlesSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
          <table className="min-w-full divide-y divide-[color:var(--line)] text-sm">
            <thead className="bg-[color:var(--panel-soft)]/65">
              <tr className="text-left text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                <th className="px-3 py-3 font-medium">{t("autobusiness.dds.articleHeader")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("autobusiness.dds.inflow")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("autobusiness.dds.outflow")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)] bg-[color:var(--surface-panel)]/35">
              {topArticles.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-3 font-medium text-[var(--ink)]">{t(entry.nameKey)}</td>
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
  );
}
