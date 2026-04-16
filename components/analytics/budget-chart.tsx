"use client";

import React, { memo, useEffect, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/ui/skeleton";
import type { BudgetChartProps } from "@/lib/types/analytics";
import { cn } from "@/lib/utils";

/**
 * Custom tooltip component with Russian formatting
 */
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-panel)] p-3 shadow-lg">
      <p className="mb-2 font-semibold text-[var(--ink)]">{label}</p>
      {payload.map((entry, index) => {
        const isVariance = entry.name === "variancePercent";
        const formattedValue = isVariance
          ? `${entry.value.toFixed(1)}%`
          : `${(entry.value / 1_000_000).toLocaleString("ru-RU")} млн ₽`;

        return (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div
              className="h-3 w-3 rounded"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[var(--ink-muted)]">
              {getTooltipLabel(entry.name)}:
            </span>
            <span className="font-medium text-[var(--ink)]">
              {formattedValue}
            </span>
          </div>
        );
      })}
    </div>
  );
});

function getTooltipLabel(name: string): string {
  const labels: Record<string, string> = {
    planned: "План",
    actual: "Факт",
    variancePercent: "Отклонение",
  };
  return labels[name] || name;
}

/**
 * Budget Analytics Chart Component
 * Displays budget vs actual spending with variance percentage
 */
export const BudgetChart = memo(function BudgetChart({
  data,
  loading = false,
  className,
}: BudgetChartProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (loading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle>Бюджет по проектам</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full animate-pulse rounded bg-[var(--surface-secondary)]" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle>Бюджет по проектам</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-center text-[var(--ink-muted)]">
              Нет данных по бюджету
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Format numbers for axis (in millions)
  const formatYAxis = (value: number) => {
    return `${(value / 1_000_000).toLocaleString("ru-RU")}`;
  };

  // Calculate max budget for Y-axis domain
  const maxBudget = Math.max(...data.map((d) => Math.max(d.planned, d.actual)));

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>Бюджет по проектам</CardTitle>
        <p className="text-sm text-[var(--ink-muted)]">
          План vs Факт с отклонением (%)
        </p>
      </CardHeader>
      <CardContent>
        <div
          className="h-[400px] w-full"
          role="img"
          aria-label="График бюджета по проектам: сравнение плана и факта"
        >
          {!mounted ? (
            <ChartSkeleton className="h-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="varianceGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--line)"
                  vertical={false}
                />
                <XAxis
                  dataKey="project"
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--line)" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="budget"
                  tickFormatter={formatYAxis}
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--line)" }}
                  tickLine={false}
                  domain={[0, maxBudget * 1.1]}
                  label={{
                    value: "Млн ₽",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--ink-muted)",
                    fontSize: 12,
                  }}
                />
                <YAxis
                  yAxisId="percent"
                  orientation="right"
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--line)" }}
                  tickLine={false}
                  domain={[-100, 100]}
                  label={{
                    value: "%",
                    angle: 90,
                    position: "insideRight",
                    fill: "var(--ink-muted)",
                    fontSize: 12,
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{
                    paddingTop: "20px",
                  }}
                  formatter={(value) => {
                    const labels: Record<string, string> = {
                      planned: "План",
                      actual: "Факт",
                      variancePercent: "Отклонение (%)",
                    };
                    return (
                      <span className="text-sm text-[var(--ink)]">
                        {labels[value] || value}
                      </span>
                    );
                  }}
                />
                <Bar
                  yAxisId="budget"
                  dataKey="planned"
                  fill="#3b82f6"
                  name="planned"
                  radius={[4, 4, 0, 0]}
                  opacity={0.8}
                />
                <Bar
                  yAxisId="budget"
                  dataKey="actual"
                  fill="#10b981"
                  name="actual"
                  radius={[4, 4, 0, 0]}
                  opacity={0.8}
                />
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey="variancePercent"
                  stroke="url(#varianceGradient)"
                  strokeWidth={2}
                  dot={{ fill: "#ef4444", strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: "#ef4444", strokeWidth: 2 }}
                  name="variancePercent"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="sr-only">
          График показывает бюджет по {data.length} проектам. 
          Синий столбец — план, зелёный — факт, красная линия — отклонение в процентах.
        </p>
      </CardContent>
    </Card>
  );
});
