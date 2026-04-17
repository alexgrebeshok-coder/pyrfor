"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { useLocale } from "@/contexts/locale-context";

export interface ProjectChartsTabProps {
  budgetSeries: Array<{ name: string; progress: number; planned: number; actual: number }>;
  resourceSeries: Array<{ name: string; capacity: number; allocated: number }>;
}

export function ProjectChartsTab({
  budgetSeries,
  resourceSeries,
}: ProjectChartsTabProps) {
  const { t } = useLocale();

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("project.progressTimeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientChart className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={budgetSeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Line
                  dataKey="progress"
                  stroke="var(--brand)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </ClientChart>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("project.budgetCurve")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientChart className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budgetSeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="planned" fill="#cbd5e1" radius={[10, 10, 0, 0]} />
                <Bar dataKey="actual" fill="var(--brand)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ClientChart>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>{t("project.resourceLoad")}</CardTitle>
          <CardDescription>{t("project.resourceLoadDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientChart className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resourceSeries} layout="vertical" margin={{ left: 24 }}>
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip />
                <Bar dataKey="capacity" fill="#e2e8f0" radius={[10, 10, 10, 10]} />
                <Bar dataKey="allocated" fill="#0f172a" radius={[10, 10, 10, 10]} />
              </BarChart>
            </ResponsiveContainer>
          </ClientChart>
        </CardContent>
      </Card>
    </div>
  );
}
