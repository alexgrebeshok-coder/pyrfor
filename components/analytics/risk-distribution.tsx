"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiskData } from "@/lib/types/analytics";
import { cn } from "@/lib/utils";
import { getLevelLabel, getLevelColor, type RiskLevel } from "@/lib/utils/risk-helpers";

interface RiskDistributionProps {
  data: RiskData[];
  loading?: boolean;
  className?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  "Технические": "Технические",
  "Финансовые": "Финансовые",
  "Организационные": "Организационные",
  "Кадровые": "Кадровые",
  "Правовые": "Правовые",
  "Прочие": "Прочие",
};

/**
 * Custom tooltip component with Russian formatting
 */
function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: {
      category: string;
      count: number;
      level: string;
    };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;

  return (
    <div className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-panel)] p-3 shadow-lg">
      <p className="mb-2 font-semibold text-[var(--ink)]">
        {CATEGORY_LABELS[data.category] || data.category}
      </p>
      <div className="flex items-center gap-2 text-sm">
        <div
          className="h-3 w-3 rounded"
          style={{ backgroundColor: getLevelColor(data.level as RiskLevel) }}
        />
        <span className="text-[var(--ink-muted)]">Количество:</span>
        <span className="font-medium text-[var(--ink)]">
          {data.count} {data.count === 1 ? "риск" : data.count < 5 ? "риска" : "рисков"}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm mt-1">
        <span className="text-[var(--ink-muted)]">Уровень:</span>
        <span className="font-medium text-[var(--ink)]">
          {getLevelLabel(data.level as RiskData['level'])}
        </span>
      </div>
    </div>
  );
}

/**
 * Risk Distribution Chart Component
 * Bar chart showing risk distribution by category
 */
export function RiskDistribution({
  data,
  loading = false,
  className,
}: RiskDistributionProps) {
  // Group risks by category and determine dominant level
  const distributionData = useMemo(() => {
    const categoryMap = new Map<string, { count: number; levels: Record<string, number> }>();

    data.forEach((risk) => {
      const current = categoryMap.get(risk.category) || { count: 0, levels: {} };
      current.count += 1;
      current.levels[risk.level] = (current.levels[risk.level] || 0) + 1;
      categoryMap.set(risk.category, current);
    });

    // Convert to array and determine dominant level for each category
    const result = Array.from(categoryMap.entries())
      .map(([category, stats]) => {
        const dominantLevel = (Object.entries(stats.levels) as Array<[RiskData['level'], number]>)
          .sort((a, b) => b[1] - a[1])[0][0];

        return {
          category,
          count: stats.count,
          level: dominantLevel,
        };
      })
      .sort((a, b) => b.count - a.count);

    return result;
  }, [data]);

  if (loading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle>Распределение рисков</CardTitle>
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
          <CardTitle>Распределение рисков</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-center text-[var(--ink-muted)]">
              Нет данных по рискам
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...distributionData.map((d) => d.count));

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>Распределение рисков</CardTitle>
        <p className="text-sm text-[var(--ink-muted)]">
          По категориям • Всего: {data.length} рисков
        </p>
      </CardHeader>
      <CardContent>
        <div
          className="h-[350px] w-full"
          role="figure"
          aria-label="График распределения рисков по категориям"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={distributionData}
              layout="vertical"
              margin={{ top: 10, right: 30, left: 10, bottom: 20 }}
              accessibilityLayer={true}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--line)"
                horizontal={true}
                vertical={false}
              />
              <XAxis
                type="number"
                tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                domain={[0, maxCount]}
                label={{
                  value: "Количество рисков",
                  position: "bottom",
                  fill: "var(--ink-muted)",
                  fontSize: 12,
                }}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                width={120}
                tickFormatter={(value: string) => CATEGORY_LABELS[value] || value}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="count"
                radius={[0, 4, 4, 0]}
                opacity={0.9}
              >
                {distributionData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={getLevelColor(entry.level as RiskLevel)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="mt-4 flex gap-4 justify-center flex-wrap">
          {(["low", "medium", "high", "critical"] as const).map((level) => (
            <div key={level} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: getLevelColor(level) }}
              />
              <span className="text-sm text-[var(--ink-muted)]">
                {getLevelLabel(level)}
              </span>
            </div>
          ))}
        </div>

        <p className="sr-only">
          График показывает распределение {data.length} рисков по {distributionData.length} категориям.
          Цвет столбца показывает доминирующий уровень риска в категории.
        </p>
      </CardContent>
    </Card>
  );
}
