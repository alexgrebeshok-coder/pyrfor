"use client";

import { useMemo } from "react";

import type { GanttApiDependency, GanttRow } from "@/components/gantt/types";

interface DependencyLayoutRow {
  x: number;
  width: number;
  y: number;
  isMilestone: boolean;
}

interface GanttDependenciesProps {
  dependencies: GanttApiDependency[];
  rows: GanttRow[];
  rowHeight: number;
  chartHeight: number;
  rowLayouts: Map<string, DependencyLayoutRow>;
  hidden?: boolean;
}

function getAnchorPoint(layout: DependencyLayoutRow, side: "start" | "finish") {
  if (layout.isMilestone) {
    return {
      x: layout.x + layout.width / 2,
      y: layout.y + 20,
    };
  }

  return {
    x: side === "start" ? layout.x : layout.x + layout.width,
    y: layout.y + 20,
  };
}

function buildDependencyPath(
  source: DependencyLayoutRow,
  target: DependencyLayoutRow,
  type: string
) {
  const sourceSide =
    type === "START_TO_START" || type === "START_TO_FINISH" ? "start" : "finish";
  const targetSide =
    type === "FINISH_TO_FINISH" || type === "START_TO_FINISH" ? "finish" : "start";

  const sourcePoint = getAnchorPoint(source, sourceSide);
  const targetPoint = getAnchorPoint(target, targetSide);
  const middleX = sourcePoint.x + Math.max(24, (targetPoint.x - sourcePoint.x) / 2);

  return `M ${sourcePoint.x} ${sourcePoint.y} L ${middleX} ${sourcePoint.y} L ${middleX} ${targetPoint.y} L ${targetPoint.x} ${targetPoint.y}`;
}

export function GanttDependencies({
  dependencies,
  rows,
  rowHeight,
  chartHeight,
  rowLayouts,
  hidden = false,
}: GanttDependenciesProps) {
  const visibleRowIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);

  if (hidden) {
    return null;
  }

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[3] overflow-visible"
      height={chartHeight}
      width="100%"
    >
      <defs>
        <marker
          id="gantt-arrow"
          markerHeight="6"
          markerWidth="6"
          orient="auto"
          refX="5"
          refY="3"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="#64748b" />
        </marker>
        <marker
          id="gantt-arrow-critical"
          markerHeight="6"
          markerWidth="6"
          orient="auto"
          refX="5"
          refY="3"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
        </marker>
      </defs>

      {dependencies.map((dependency) => {
        if (!visibleRowIds.has(dependency.source) || !visibleRowIds.has(dependency.target)) {
          return null;
        }

        const source = rowLayouts.get(dependency.source);
        const target = rowLayouts.get(dependency.target);
        if (!source || !target) {
          return null;
        }

        const isCritical = dependency.isCritical;
        const stroke = isCritical ? "#ef4444" : "#64748b";
        const markerEnd = isCritical ? "url(#gantt-arrow-critical)" : "url(#gantt-arrow)";
        const path = buildDependencyPath(source, target, dependency.type);

        const labelX = Math.max(source.x, target.x) - 10;
        const labelY = Math.min(source.y, target.y) + rowHeight / 2;

        return (
          <g key={dependency.id}>
            <path
              d={path}
              fill="none"
              markerEnd={markerEnd}
              stroke={stroke}
              strokeDasharray={dependency.lagDays ? "4 4" : undefined}
              strokeWidth={isCritical ? 2.2 : 1.4}
            />
            {dependency.lagDays !== 0 ? (
              <text
                fill={stroke}
                fontSize="10"
                fontWeight="600"
                textAnchor="end"
                x={labelX}
                y={labelY}
              >
                {dependency.lagDays > 0 ? `+${dependency.lagDays}д` : `${dependency.lagDays}д`}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
