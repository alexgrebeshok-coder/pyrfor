"use client";

import { Wallet } from "lucide-react";
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

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { Progress } from "@/components/ui/progress";
import { useLocale } from "@/contexts/locale-context";
import type { ContractView } from "@/components/resources/types";
import { formatCurrency, safePercent } from "@/lib/utils";

export interface ProjectFinanceTabProps {
  currency: string;
  projectEvm?: {
    source: "task_costs" | "project_budget";
    metrics: {
      BAC: number;
      AC: number;
      CPI: number;
      SPI: number;
      EAC: number;
      TCPI: number | null;
    };
  };
  financeSummary?: {
    total: number;
    pending: number;
    byCategory: Array<{
      categoryId: string;
      name: string;
      amount: number;
      color: string | null;
    }>;
  };
  evmSeries: Array<{ label: string; PV: number; EV: number; AC: number }>;
  financeCategorySeries: Array<{ name: string; amount: number }>;
  contractItems: ContractView[];
  overdueContracts: ContractView[];
}

export function ProjectFinanceTab({
  currency,
  projectEvm,
  financeSummary,
  evmSeries,
  financeCategorySeries,
  contractItems,
  overdueContracts,
}: ProjectFinanceTabProps) {
  const { formatDateLocalized } = useLocale();

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-[var(--ink-muted)]">BAC / AC</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {projectEvm ? formatCurrency(projectEvm.metrics.BAC, currency) : "—"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Факт: {projectEvm ? formatCurrency(projectEvm.metrics.AC, currency) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Wallet className="h-4 w-4" />
              CPI / SPI
            </p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {projectEvm ? `${projectEvm.metrics.CPI.toFixed(2)} / ${projectEvm.metrics.SPI.toFixed(2)}` : "—"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              TCPI {projectEvm?.metrics.TCPI?.toFixed(2) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-[var(--ink-muted)]">Expenses</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {financeSummary ? formatCurrency(financeSummary.total, currency) : "—"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Pending: {financeSummary ? formatCurrency(financeSummary.pending, currency) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-[var(--ink-muted)]">Contracts at risk</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {overdueContracts.length}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Открытых контрактов: {contractItems.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>EVM S-curve</CardTitle>
            <CardDescription>
              {projectEvm?.source === "task_costs"
                ? "Собрана по costed tasks"
                : "Собрана по бюджету проекта"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {evmSeries.length ? (
              <ClientChart className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={evmSeries}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="PV" stroke="#0ea5e9" strokeWidth={2} type="monotone" />
                    <Line dataKey="EV" stroke="#10b981" strokeWidth={2} type="monotone" />
                    <Line dataKey="AC" stroke="#f97316" strokeWidth={2} type="monotone" />
                  </LineChart>
                </ResponsiveContainer>
              </ClientChart>
            ) : (
              <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                История snapshots ещё не накоплена. Текущий EAC:{" "}
                {projectEvm ? formatCurrency(projectEvm.metrics.EAC, currency) : "—"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expense mix</CardTitle>
            <CardDescription>Топ-категории расходов по проекту</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {financeCategorySeries.length ? (
              <>
                <ClientChart className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={financeCategorySeries} layout="vertical" margin={{ left: 20 }}>
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
                      <Bar dataKey="amount" fill="var(--brand)" radius={[10, 10, 10, 10]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ClientChart>
                <div className="grid gap-2">
                  {financeSummary?.byCategory.slice(0, 4).map((entry) => (
                    <div
                      key={entry.categoryId}
                      className="flex items-center justify-between rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/60 px-4 py-3"
                    >
                      <span className="text-sm text-[var(--ink)]">{entry.name}</span>
                      <span className="text-sm font-medium text-[var(--ink)]">
                        {formatCurrency(entry.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                По проекту пока нет расходов с категоризацией.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contract register</CardTitle>
          <CardDescription>Статус обязательств и оплат по проекту</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {contractItems.length ? (
            contractItems.map((contract) => {
              const usage = safePercent(contract.paidAmount, contract.amount);
              return (
                <div
                  key={contract.id}
                  className="rounded-[22px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--ink)]">
                        {contract.number} · {contract.title}
                      </p>
                      <p className="text-sm text-[var(--ink-soft)]">
                        {contract.supplier.name} · {formatDateLocalized(contract.endDate, "d MMM yyyy")}
                      </p>
                    </div>
                    <Badge
                      variant={
                        usage >= 100
                          ? "success"
                          : new Date(contract.endDate).getTime() < Date.now()
                            ? "danger"
                            : "warning"
                      }
                    >
                      {contract.status}
                    </Badge>
                  </div>
                  <div className="mt-4">
                    <Progress value={Math.min(usage, 100)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-soft)]">
                    <span>{formatCurrency(contract.paidAmount, contract.currency)} оплачено</span>
                    <span>{formatCurrency(contract.amount, contract.currency)} всего</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
              Для проекта пока нет зарегистрированных контрактов.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
