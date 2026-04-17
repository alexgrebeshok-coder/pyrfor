"use client";

import type { GanttResourceSeries } from "@/components/gantt/types";
import { ResourceHistogram } from "@/components/gantt/resource-histogram";
import { fieldStyles } from "@/components/ui/field";

interface GanttResourcePanelProps {
  resourceSeries: GanttResourceSeries[];
  selectedResourceSeries: GanttResourceSeries | null;
  onResourceKeyChange: (key: string) => void;
  dayWidth: number;
  chartWidth: number;
}

export function GanttResourcePanel({
  resourceSeries,
  selectedResourceSeries,
  onResourceKeyChange,
  dayWidth,
  chartWidth,
}: GanttResourcePanelProps) {
  return (
    <div className="space-y-3 border-t border-[var(--line)] px-3 pb-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-[var(--ink)]">Resource histogram</div>
        <select
          className={`${fieldStyles} h-9 max-w-[280px] px-3 py-2 text-sm`}
          onChange={(event) => onResourceKeyChange(event.target.value)}
          value={selectedResourceSeries?.key ?? ""}
        >
          {resourceSeries.map((series) => (
            <option key={series.key} value={series.key}>
              {series.label}
            </option>
          ))}
        </select>
      </div>
      <ResourceHistogram dayWidth={Math.max(6, dayWidth)} series={selectedResourceSeries} width={chartWidth} />
    </div>
  );
}
