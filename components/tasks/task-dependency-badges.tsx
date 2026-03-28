"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/contexts/locale-context";
import type { Task } from "@/lib/types";

export function TaskDependencyBadges({
  compact = false,
  task,
}: {
  compact?: boolean;
  task: Task;
}) {
  const { locale, formatDateLocalized } = useLocale();
  const summary = task.dependencySummary;

  if (!summary && !task.blockedReason) {
    return null;
  }

  const labels = {
    dependencies:
      locale === "ru" ? "Зависимости" : locale === "zh" ? "依赖" : "Dependencies",
    waiting:
      locale === "ru" ? "Ждёт" : locale === "zh" ? "等待中" : "Waiting",
    impacts:
      locale === "ru" ? "Влияет" : locale === "zh" ? "影响" : "Impacts",
    earliest:
      locale === "ru" ? "Разблокировка" : locale === "zh" ? "可解锁时间" : "Unblock",
  };

  const hasBadges =
    (summary?.dependencyCount ?? 0) > 0 ||
    (summary?.blockingDependencyCount ?? 0) > 0 ||
    (summary?.downstreamImpactCount ?? 0) > 0;

  return (
    <div className={compact ? "mt-2 grid gap-2" : "mt-3 grid gap-2"}>
      {hasBadges ? (
        <div className="flex flex-wrap gap-2">
          {summary?.dependencyCount ? (
            <Badge variant="neutral" className={compact ? "px-1.5 py-0.5 text-[10px]" : undefined}>
              {labels.dependencies}: {summary.dependencyCount}
            </Badge>
          ) : null}
          {summary?.blockingDependencyCount ? (
            <Badge variant="warning" className={compact ? "px-1.5 py-0.5 text-[10px]" : undefined}>
              {labels.waiting}: {summary.blockingDependencyCount}
            </Badge>
          ) : null}
          {summary?.downstreamImpactCount ? (
            <Badge variant="info" className={compact ? "px-1.5 py-0.5 text-[10px]" : undefined}>
              {labels.impacts}: {summary.downstreamImpactCount}
            </Badge>
          ) : null}
          {summary?.earliestBlockingDueDate ? (
            <Badge variant="neutral" className={compact ? "px-1.5 py-0.5 text-[10px]" : undefined}>
              {labels.earliest}: {formatDateLocalized(summary.earliestBlockingDueDate, "d MMM")}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {task.blockedReason ? (
        <div
          className={
            compact
              ? "rounded-[8px] border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100"
              : "rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
          }
        >
          {task.blockedReason}
        </div>
      ) : null}
    </div>
  );
}
