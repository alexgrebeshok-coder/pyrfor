"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ClientChart } from "@/components/ui/client-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpensesResponse } from "@/components/expenses/types";
import { formatCurrency } from "@/lib/utils";

const COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#64748b"];

export function ExpenseSummary({ summary }: { summary: ExpensesResponse["summary"] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense mix</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ClientChart className="h-full">
            {() => (
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={summary.byCategory}
                    dataKey="amount"
                    innerRadius={60}
                    outerRadius={96}
                    paddingAngle={2}
                  >
                    {summary.byCategory.map((entry, index) => (
                      <Cell
                        fill={entry.color ?? COLORS[index % COLORS.length]}
                        key={entry.categoryId}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? formatCurrency(value) : String(value ?? "—")
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ClientChart>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Финансовая сводка</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)]/40 p-4">
            <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">Total</div>
            <div className="mt-2 text-2xl font-semibold text-[var(--ink)]">
              {formatCurrency(summary.total)}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="text-xs uppercase tracking-[0.12em] text-emerald-600">Approved / Paid</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-600">
              {formatCurrency(summary.approved)}
            </div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="text-xs uppercase tracking-[0.12em] text-amber-600">Pending</div>
            <div className="mt-2 text-2xl font-semibold text-amber-600">
              {formatCurrency(summary.pending)}
            </div>
          </div>

          <div className="md:col-span-3">
            <div className="space-y-2">
              {summary.byCategory.slice(0, 6).map((entry, index) => (
                <div
                  key={entry.categoryId}
                  className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: entry.color ?? COLORS[index % COLORS.length] }}
                    />
                    {entry.name}
                  </div>
                  <div className="text-sm font-semibold text-[var(--ink)]">
                    {formatCurrency(entry.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
