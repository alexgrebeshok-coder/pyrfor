"use client";

import useSWR from "swr";
import {
  AlertTriangle,
  HardHat,
  Package,
  Truck,
  Users,
} from "lucide-react";
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

import type { ExpensesResponse } from "@/components/expenses/types";
import type { EquipmentView, MaterialView } from "@/components/resources/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { api } from "@/lib/client/api-error";
import { formatCurrency, safePercent } from "@/lib/utils";

type TeamResponse = {
  team: Array<{
    id: string;
    name: string;
    role: string;
    capacity: number;
    allocated: number;
    hourlyRate: number | null;
    activeTasks: number;
    capacityUsed: number;
    projects: Array<{ id: string; name: string }>;
  }>;
};

type EquipmentResponse = {
  equipment: EquipmentView[];
};

type MaterialsResponse = {
  materials: MaterialView[];
};

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Users;
}) {
  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          <Icon className="h-4 w-4" />
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-[var(--ink)]">{value}</div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function ResourcesPage() {
  const { data: teamResponse } = useSWR<TeamResponse>("/api/team", (url: string) =>
    api.get<TeamResponse>(url)
  );
  const { data: equipmentResponse } = useSWR<EquipmentResponse>("/api/equipment", (url: string) =>
    api.get<EquipmentResponse>(url)
  );
  const { data: materialsResponse } = useSWR<MaterialsResponse>(
    "/api/materials?lowStock=true",
    (url: string) => api.get<MaterialsResponse>(url)
  );
  const { data: expensesResponse } = useSWR<ExpensesResponse>("/api/expenses", (url: string) =>
    api.get<ExpensesResponse>(url)
  );

  const team = teamResponse?.team ?? [];
  const equipment = equipmentResponse?.equipment ?? [];
  const lowStockMaterials = materialsResponse?.materials ?? [];
  const expenses = expensesResponse?.expenses ?? [];

  const avgUtilization = team.length
    ? Math.round(team.reduce((sum, member) => sum + member.allocated, 0) / team.length)
    : 0;
  const overallocatedPeople = team.filter((member) => member.allocated > member.capacity);
  const assignedEquipment = equipment.filter(
    (item) => item.project || item.status !== "available"
  );

  const teamLoadData = team.map((member) => ({
    name: member.name,
    capacity: member.capacity,
    allocated: member.allocated,
  }));

  const resourceCostByProject = Object.values(
    expenses.reduce<
      Record<
        string,
        {
          project: string;
          labor: number;
          equipment: number;
          materials: number;
        }
      >
    >((accumulator, expense) => {
      const key = expense.project.id;
      const current = accumulator[key] ?? {
        project: expense.project.name,
        labor: 0,
        equipment: 0,
        materials: 0,
      };

      const code = expense.category.code.toLowerCase();
      if (code.includes("labor")) {
        current.labor += expense.amount;
      } else if (code.includes("equipment")) {
        current.equipment += expense.amount;
      } else if (code.includes("material")) {
        current.materials += expense.amount;
      }

      accumulator[key] = current;
      return accumulator;
    }, {})
  )
    .sort(
      (left, right) =>
        right.labor +
        right.equipment +
        right.materials -
        (left.labor + left.equipment + left.materials)
    )
    .slice(0, 8);

  const overallocationReport = overallocatedPeople.map((member) => ({
    id: member.id,
    label: member.name,
    description: `${member.allocated}% из ${member.capacity}% · ${member.activeTasks} активных задач`,
    overload: member.allocated - member.capacity,
  }));

  return (
    <div className="container mx-auto space-y-6 py-6" data-testid="resources-page">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Ресурсный cockpit</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Люди, техника, материалы и сигналы перегрузки в одном окне
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Средняя загрузка команды"
          value={`${avgUtilization}%`}
          description={`${team.length} участников в текущем контуре`}
          icon={Users}
        />
        <MetricCard
          title="Перегруженные исполнители"
          value={String(overallocatedPeople.length)}
          description="allocated выше capacity"
          icon={AlertTriangle}
        />
        <MetricCard
          title="Техника в работе"
          value={`${assignedEquipment.length}/${equipment.length}`}
          description="назначена на проект или выведена из available"
          icon={Truck}
        />
        <MetricCard
          title="Критические материалы"
          value={String(lowStockMaterials.length)}
          description="stock <= minStock"
          icon={Package}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Загрузка людей</CardTitle>
            <CardDescription>Allocated vs capacity по каждому участнику</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px] min-w-0">
            <ClientChart className="h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamLoadData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" hide={teamLoadData.length > 8} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="capacity" fill="#94a3b8" name="Capacity" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="allocated" fill="#0ea5e9" name="Allocated" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ClientChart>
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Overallocation report</CardTitle>
            <CardDescription>Кого нужно выравнивать в первую очередь</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overallocationReport.length ? (
              overallocationReport.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-[var(--ink)]">{item.label}</div>
                    <Badge variant="danger">+{item.overload}%</Badge>
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-muted)]">{item.description}</div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-700">
                Перегруженных участников не найдено.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Стоимость ресурсов по проектам</CardTitle>
            <CardDescription>
              Фактические расходы, сгруппированные по labor / equipment / materials
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px] min-w-0">
            <ClientChart className="h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resourceCostByProject}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="project" hide={resourceCostByProject.length > 6} />
                  <YAxis tickFormatter={formatCompactCurrency} />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? formatCurrency(value, "RUB") : String(value ?? "—")
                    }
                  />
                  <Legend />
                  <Bar dataKey="labor" stackId="cost" fill="#0ea5e9" name="Labor" />
                  <Bar dataKey="equipment" stackId="cost" fill="#8b5cf6" name="Equipment" />
                  <Bar dataKey="materials" stackId="cost" fill="#10b981" name="Materials" />
                </BarChart>
              </ResponsiveContainer>
            </ClientChart>
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Критические материалы</CardTitle>
            <CardDescription>Позиции, где запас уже на пороге минимума</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lowStockMaterials.length ? (
              lowStockMaterials.map((material) => (
                <div
                  key={material.id}
                  className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--ink)]">{material.name}</div>
                      <div className="text-xs text-[var(--ink-muted)]">{material.category}</div>
                    </div>
                    <Badge variant="warning">
                      {safePercent(material.currentStock, material.minStock || 1)}%
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-[var(--ink-muted)]">
                    {material.currentStock} {material.unit} / min {material.minStock} {material.unit}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-700">
                Критических остатков не найдено.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            Техника по статусам
          </CardTitle>
          <CardDescription>Краткий fleet-view по текущему состоянию</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {equipment.slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--line)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--ink)]">{item.name}</div>
                  <div className="text-xs text-[var(--ink-muted)]">{item.type}</div>
                </div>
                <Badge>{item.status}</Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm text-[var(--ink-muted)]">
                <div>Проект: {item.project?.name ?? "Свободна"}</div>
                <div>Локация: {item.location ?? "Не указана"}</div>
                <div>
                  Ставка:{" "}
                  {item.dailyRate
                    ? formatCurrency(item.dailyRate, "RUB")
                    : item.hourlyRate
                      ? formatCurrency(item.hourlyRate, "RUB")
                      : "—"}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
