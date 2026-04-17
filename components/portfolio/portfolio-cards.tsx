"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { Sparkles } from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnalyticsRecommendation } from "@/lib/types/analytics";

export const toneClasses = {
  success:
    "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
  warning:
    "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  danger:
    "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30",
  info: "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
} as const;

export function formatRatio(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(2);
}

export function getCountVariant(count: number) {
  if (count === 0) return "success" as const;
  if (count <= 2) return "warning" as const;
  return "danger" as const;
}

export function getPriorityVariant(priority: AnalyticsRecommendation["priority"]) {
  switch (priority) {
    case "critical":
      return "danger" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    case "low":
    default:
      return "neutral" as const;
  }
}

export function getRecommendationTone(priority: AnalyticsRecommendation["priority"]) {
  switch (priority) {
    case "critical":
      return toneClasses.danger;
    case "high":
      return toneClasses.warning;
    case "medium":
      return toneClasses.info;
    case "low":
    default:
      return "border-[var(--line)] bg-[var(--panel-soft)]/60";
  }
}

export function MiniSignalCard({
  icon: Icon,
  label,
  value,
  variant,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  variant: "success" | "warning" | "danger" | "info";
  description: string;
}) {
  return (
    <div className={cn("rounded-2xl border p-2.5", toneClasses[variant])}>
      <div className="flex items-start gap-2.5">
        <div className="rounded-xl bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Icon className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
          <p className="mt-1 text-lg font-semibold tracking-[-0.08em] text-[var(--ink)]">{value}</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  variant,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
  variant: "success" | "warning" | "danger" | "info";
}) {
  const variantStyles = {
    success: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
    warning: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
    danger: "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30",
    info: "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
  } as const;

  return (
    <div className={cn("rounded-2xl border p-2.5", variantStyles[variant])} data-testid="portfolio-metric-card">
      <div className="flex items-start gap-2.5">
        <div className="rounded-xl bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Icon className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
          <p className="mt-1 text-base font-semibold tracking-[-0.08em] text-[var(--ink)]">{value}</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function RecommendationCard({ recommendation }: { recommendation: AnalyticsRecommendation }) {
  const { t } = useLocale();

  return (
    <div className={cn("rounded-2xl border p-2.5", getRecommendationTone(recommendation.priority))}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-white/70 p-1.5 shadow-sm dark:bg-black/20">
          <Sparkles className="h-4 w-4 text-[var(--ink)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
              {recommendation.title}
            </p>
            <Badge variant={getPriorityVariant(recommendation.priority)}>
              {recommendation.priority}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">
            {recommendation.description}
          </p>
          <p className="mt-2 text-xs font-medium text-[var(--ink)]">{recommendation.action}</p>
          {recommendation.projectName ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">{recommendation.projectName}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="neutral">{t(`recommendations.types.${recommendation.type}`)}</Badge>
        <Link className="text-xs font-semibold text-[var(--brand)]" href="/command-center">
          {t("action.open")}
        </Link>
      </div>
    </div>
  );
}
