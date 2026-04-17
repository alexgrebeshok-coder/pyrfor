"use client";

import { AlertTriangle, BarChart3, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import type { Risk } from "@/lib/types";
import { cn, getRiskSeverity, riskStatusMeta } from "@/lib/utils";

export interface ProjectRisksTabProps {
  projectRisks: Risk[];
}

export function ProjectRisksTab({ projectRisks }: ProjectRisksTabProps) {
  const { enumLabel, t } = useLocale();

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("project.riskMatrix")}</CardTitle>
          <CardDescription>{t("project.riskMatrixDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }, (_, rowIndex) => 5 - rowIndex).map((probability) => (
            <div key={probability} className="grid grid-cols-[80px_repeat(5,minmax(0,1fr))] gap-2">
              <div className="flex items-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                P{probability}
              </div>
              {Array.from({ length: 5 }, (_, columnIndex) => columnIndex + 1).map((impact) => {
                const cellRisks = projectRisks.filter(
                  (risk) => risk.probability === probability && risk.impact === impact
                );
                const danger = probability * impact >= 16;
                const warning = probability * impact >= 9;
                return (
                  <div
                    key={`${probability}-${impact}`}
                    className={cn(
                      "group relative min-h-[96px] rounded-[18px] border p-3 transition-all hover:scale-[1.02] hover:shadow-md",
                      danger
                        ? "border-rose-200 bg-rose-50"
                        : warning
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                    )}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      I{impact}
                    </div>
                    <div className="mt-2 grid gap-2">
                      {cellRisks.slice(0, 2).map((risk) => (
                        <div
                          key={risk.id}
                          className="truncate rounded-xl bg-white/80 px-2 py-1.5 text-xs font-medium text-[var(--ink)]"
                          title={risk.title}
                        >
                          {risk.title}
                        </div>
                      ))}
                      {cellRisks.length > 2 && (
                        <div className="rounded-xl bg-white/60 px-2 py-1 text-xs text-[var(--ink-muted)]">
                          +{cellRisks.length - 2} more
                        </div>
                      )}
                    </div>
                    {/* Hover tooltip for all risks */}
                    {cellRisks.length > 0 && (
                      <div className="absolute left-0 top-full z-10 mt-2 hidden w-48 rounded-lg border border-[var(--line)] bg-[var(--surface-panel)] p-3 shadow-lg group-hover:block">
                        <div className="text-xs font-semibold text-[var(--ink)] mb-2">
                          {cellRisks.length} risk{cellRisks.length > 1 ? 's' : ''} in this cell
                        </div>
                        {cellRisks.map((risk) => (
                          <div key={risk.id} className="text-xs text-[var(--ink-soft)] py-1">
                            • {risk.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("project.riskRegister")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {projectRisks.map((risk) => (
            <div
              key={risk.id}
              className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--ink)]">{risk.title}</p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{risk.mitigation}</p>
                </div>
                <Badge className={cn("ring-1", riskStatusMeta[risk.status].className)}>
                  {enumLabel("riskStatus", risk.status)}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-soft)]">
                <span className="flex items-center gap-1">
                  <ShieldAlert className="h-4 w-4 text-[var(--ink-muted)]" />
                  {risk.owner}
                </span>
                <span className="flex items-center gap-1">
                  <BarChart3 className="h-4 w-4 text-[var(--ink-muted)]" />
                  {risk.probability} × {risk.impact}
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-[var(--ink-muted)]" />
                  {risk.category}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
