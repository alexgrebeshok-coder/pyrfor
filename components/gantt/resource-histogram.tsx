"use client";

import type { GanttResourceSeries } from "@/components/gantt/types";
import { cn } from "@/lib/utils";

interface ResourceHistogramProps {
  series: GanttResourceSeries | null;
  width: number;
  dayWidth: number;
}

export function ResourceHistogram({ series, width, dayWidth }: ResourceHistogramProps) {
  if (!series) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/40 p-4 text-sm text-[var(--ink-muted)]">
        Нет назначений ресурсов для построения гистограммы.
      </div>
    );
  }

  const maxValue = Math.max(series.maxLoad, 1, ...series.points.map((point) => point.capacity));
  const height = 160;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-panel)]">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="text-sm font-semibold text-[var(--ink)]">{series.label}</div>
        <div className="text-xs text-[var(--ink-muted)]">
          Загрузка по дням. Красный бар — перегрузка относительно capacity.
        </div>
      </div>
      <div className="overflow-x-auto px-3 py-4">
        <div className="relative" style={{ height, width }}>
          <div
            className="absolute inset-x-0 border-t border-dashed border-[var(--line-strong)]"
            style={{ top: height - (series.points[0]?.capacity ?? 1) / maxValue * (height - 24) }}
          />
          {series.points.map((point, index) => {
            const barHeight = Math.max(4, (point.load / maxValue) * (height - 24));
            const overloaded = point.load > point.capacity;
            return (
              <div
                key={`${series.key}-${point.date}`}
                className={cn(
                  "absolute bottom-0 rounded-t-sm",
                  overloaded ? "bg-rose-500/90" : "bg-sky-500/85"
                )}
                style={{
                  left: index * dayWidth + 1,
                  width: Math.max(2, dayWidth - 2),
                  height: barHeight,
                }}
                title={`${point.date}: ${point.load.toFixed(2)} / ${point.capacity.toFixed(2)}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
