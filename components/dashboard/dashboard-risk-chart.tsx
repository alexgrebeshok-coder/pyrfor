"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export function DashboardRiskChart({
  data,
}: {
  data: Array<{ name: string; value: number; color: string }>;
}) {
  return (
    <div
      role="img"
      aria-label="Матрица рисков: распределение по степени критичности"
      className="h-full w-full"
    >
      <ResponsiveContainer height="100%" width="100%">
        <PieChart aria-hidden="true">
          <Pie data={data} dataKey="value" innerRadius={46} outerRadius={70}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
