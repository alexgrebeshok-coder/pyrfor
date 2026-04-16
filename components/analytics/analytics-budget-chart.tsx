"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ClientChart } from "@/components/ui/client-chart";

export function AnalyticsBudgetChart({
  data,
}: {
  data: Array<{ name: string; health: number; budgetVariance: number }>;
}) {
  return (
    <ClientChart className="h-full">
      {() => (
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="budgetVariance" fill="var(--ink-soft)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="health" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ClientChart>
  );
}
