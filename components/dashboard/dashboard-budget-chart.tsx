"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, ReferenceLine } from "recharts";

import { ClientChart } from "@/components/ui/client-chart";

export function DashboardBudgetChart({
  data,
}: {
  data: Array<{ name: string; planned: number; actual: number }>;
}) {
  // Calculate variance for each project
  const varianceData = data.map((item) => ({
    name: item.name,
    variance: item.actual - item.planned,
    variancePercent: item.planned > 0 ? Math.round(((item.actual - item.planned) / item.planned) * 100) : 0,
  }));

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mb-2 text-[10px]">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-emerald-500" />
          <span className="text-muted-foreground">Экономия</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-rose-500" />
          <span className="text-muted-foreground">Перерасход</span>
        </div>
      </div>

      {/* Chart */}
      <div
        role="img"
        aria-label="Диаграмма отклонения бюджета: план vs факт по проектам"
        className="flex-1"
      >
        <ClientChart className="h-full">
          {() => (
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={varianceData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} aria-hidden="true">
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{ fontSize: 9 }}
                  width={70}
                />
                <ReferenceLine x={0} stroke="var(--line)" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div className="bg-[var(--surface-panel)] border border-[var(--line)] rounded px-2 py-1 text-xs shadow-md">
                          <p className="font-medium">{item.name}</p>
                          <p className={item.variance >= 0 ? "text-rose-500" : "text-emerald-500"}>
                            {item.variance >= 0 ? "+" : ""}{item.variancePercent}%
                            {item.variance >= 0 ? " (перерасход)" : " (экономия)"}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="variancePercent" radius={[0, 2, 2, 0]}>
                  {varianceData.map((entry, index) => (
                    <Cell 
                      key={index} 
                      fill={entry.variance >= 0 ? "#f43f5e" : "#10b981"} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ClientChart>
      </div>
    </div>
  );
}
