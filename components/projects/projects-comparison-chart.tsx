"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ClientChart } from "@/components/ui/client-chart";

export function ProjectsComparisonChart({
  data,
}: {
  data: Array<{ name: string; progress: number; health: number }>;
}) {
  return (
    <ClientChart className="h-full">
      {() => (
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} barCategoryGap="15%" margin={{ top: 10, right: 10, left: -20, bottom: 50 }}>
            <XAxis 
              dataKey="name" 
              tickLine={false} 
              axisLine={false}
              tick={{ fontSize: 9, fill: 'var(--ink-soft)' }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              tickLine={false} 
              axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'var(--panel)', 
                border: '1px solid var(--line)',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            />
            <Bar dataKey="progress" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Прогресс %" />
            <Bar dataKey="health" fill="#10b981" radius={[3, 3, 0, 0]} name="Здоровье %" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ClientChart>
  );
}
