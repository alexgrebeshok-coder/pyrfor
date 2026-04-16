"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ClientChart } from "@/components/ui/client-chart";

export function AnalyticsTrendChart({
  data,
}: {
  data: Array<{ name: string; progress: number; spend: number }>;
}) {
  return (
    <ClientChart className="h-full">
      {() => (
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={data}>
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip />
            <Area dataKey="spend" fill="var(--panel-soft)" stroke="var(--ink-soft)" type="monotone" />
            <Area dataKey="progress" fill="rgba(59,130,246,0.18)" stroke="var(--brand)" type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ClientChart>
  );
}
