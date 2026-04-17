"use client";

import { AlertTriangle, Package, Truck } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import type { EquipmentView, MaterialView } from "@/components/resources/types";
import { formatCurrency } from "@/lib/utils";

interface TeamMemberSummary {
  allocated: number;
  capacity: number;
}

export interface ProjectResourcesTabProps {
  projectTeam: TeamMemberSummary[];
  resourceUtilization: number;
  equipmentItems: EquipmentView[];
  materialItems: MaterialView[];
  lowStockProjectMaterials: MaterialView[];
  resourceSeries: Array<{ name: string; capacity: number; allocated: number }>;
  currency: string;
}

export function ProjectResourcesTab({
  projectTeam,
  resourceUtilization,
  equipmentItems,
  materialItems,
  lowStockProjectMaterials,
  resourceSeries,
  currency,
}: ProjectResourcesTabProps) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-[var(--ink-muted)]">Team assigned</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {projectTeam.length}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Avg load {resourceUtilization}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Truck className="h-4 w-4" />
              Equipment assigned
            </p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {equipmentItems.length}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Активных назначений: {equipmentItems.reduce((sum, item) => sum + item.assignments.length, 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Package className="h-4 w-4" />
              Materials in use
            </p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {materialItems.length}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Low stock: {lowStockProjectMaterials.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <AlertTriangle className="h-4 w-4" />
              Overallocated
            </p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {projectTeam.filter((member) => member.allocated > member.capacity).length}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Требуют resource leveling
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>People load</CardTitle>
            <CardDescription>Загрузка участников проекта</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientChart className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resourceSeries} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={120}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="capacity" fill="#e2e8f0" radius={[10, 10, 10, 10]} />
                  <Bar dataKey="allocated" fill="#0f172a" radius={[10, 10, 10, 10]} />
                </BarChart>
              </ResponsiveContainer>
            </ClientChart>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Field resource watchlist</CardTitle>
            <CardDescription>Техника и материалы с самым высоким риском</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {equipmentItems.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--ink)]">{item.name}</p>
                    <p className="text-sm text-[var(--ink-soft)]">{item.type}</p>
                  </div>
                  <Badge variant={item.status === "available" ? "success" : "warning"}>
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  {item.location ?? "Локация не указана"} ·{" "}
                  {item.dailyRate
                    ? formatCurrency(item.dailyRate, currency)
                    : item.hourlyRate
                      ? formatCurrency(item.hourlyRate, currency)
                      : "Без ставки"}
                </p>
              </div>
            ))}
            {lowStockProjectMaterials.slice(0, 3).map((material) => (
              <div
                key={material.id}
                className="rounded-[20px] border border-amber-200 bg-amber-50 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--ink)]">{material.name}</p>
                    <p className="text-sm text-[var(--ink-soft)]">{material.category}</p>
                  </div>
                  <Badge variant="warning">
                    {material.currentStock}/{material.minStock} {material.unit}
                  </Badge>
                </div>
              </div>
            ))}
            {!equipmentItems.length && !lowStockProjectMaterials.length ? (
              <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                По проекту пока нет техники или материалов с риск-сигналами.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
