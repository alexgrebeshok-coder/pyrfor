"use client";

import React, { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Download,
  DollarSign,
  LineChart as LineChartIcon,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
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

import { ExpenseSummary } from "@/components/expenses/expense-summary";
import type { ExpensesResponse } from "@/components/expenses/types";
import type { ContractView } from "@/components/resources/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientChart } from "@/components/ui/client-chart";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/client/api-error";
import {
  getDemoContracts,
  getDemoEvmHistory,
  getDemoExpensesResponse,
  getDemoPortfolioEvm,
  getDemoProjectsFinanceResponse,
} from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
import { useBudgetData } from "@/lib/hooks/use-budget-data";
import { formatCurrency, safePercent } from "@/lib/utils";

type FinanceMetric = {
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  status: "success" | "warning" | "danger" | "info";
};

type EvmMetricPayload = {
  BAC: number;
  PV: number;
  EV: number;
  AC: number;
  CV: number;
  SV: number;
  CPI: number;
  SPI: number;
  EAC: number;
  ETC: number;
  VAC: number;
  TCPI: number | null;
  TCPI_EAC: number | null;
};

type PortfolioEvmResponse = {
  referenceDate: string;
  metrics: EvmMetricPayload;
  projects: Array<{
    projectId: string;
    projectName: string;
    source: "task_costs" | "project_budget";
    metrics: EvmMetricPayload;
    summary: {
      taskCount: number;
      costedTaskCount: number;
      taskBudgetCoverage: number;
    };
  }>;
  summary: {
    projectCount: number;
    taskCount: number;
    costedTaskCount: number;
  };
};

type EvmHistoryResponse = {
  projectId: string;
  snapshots: Array<{
    id: string;
    date: string;
    bac: number;
    pv: number;
    ev: number;
    ac: number;
    cpi: number | null;
    spi: number | null;
    eac: number | null;
    tcpi: number | null;
  }>;
};

type ProjectsFinanceResponse = {
  projects: Array<{
    id: string;
    name: string;
    start: string;
    end: string;
    budgetPlan: number | null;
    budgetFact: number | null;
  }>;
};

function FinanceMetricCard({ metric }: { metric: FinanceMetric }) {
  const statusColors = {
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-rose-600",
    info: "text-sky-600",
  };

  const trendColors = {
    up: "text-emerald-600",
    down: "text-rose-600",
    neutral: "text-slate-500",
  };

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
          {metric.label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <p className={`text-2xl font-semibold ${statusColors[metric.status]}`}>
              {metric.value}
            </p>
            {metric.trend && metric.trendValue ? (
              <div className="mt-1 flex items-center gap-1">
                {metric.trend === "up" ? <TrendingUp className="h-3 w-3" /> : null}
                {metric.trend === "down" ? <TrendingDown className="h-3 w-3" /> : null}
                <span className={`text-xs ${trendColors[metric.trend]}`}>
                  {metric.trendValue}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)]/40 p-4">
      <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">{label}</div>
      <div className="mt-2 text-xl font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}

export default function FinancePage() {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const { data: budgetData, isLoading } = useBudgetData();
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const { data: liveExpensesResponse } = useSWR<ExpensesResponse>(isDemoWorkspace ? null : "/api/expenses", (url: string) =>
    api.get<ExpensesResponse>(url)
  );
  const { data: liveContractsResponse } = useSWR<{ contracts: ContractView[] }>(isDemoWorkspace ? null : "/api/contracts", (url: string) =>
    api.get<{ contracts: ContractView[] }>(url)
  );
  const {
    data: liveEvmPortfolio,
    isLoading: evmLoading,
    mutate: refreshEvm,
  } = useSWR<PortfolioEvmResponse>(isDemoWorkspace ? null : "/api/evm", (url: string) => api.get<PortfolioEvmResponse>(url));
  const { data: liveScheduledProjects } = useSWR<ProjectsFinanceResponse>(
    isDemoWorkspace
      ? null
      : "/api/projects?limit=50&includeTasks=false&includeTeam=false&includeRisks=false&includeMilestones=false&includeDocuments=false",
    (url: string) => api.get<ProjectsFinanceResponse>(url)
  );
  const { data: liveEvmHistory, mutate: refreshHistory } = useSWR<EvmHistoryResponse>(
    isDemoWorkspace ? null : selectedProjectId ? `/api/evm/history?projectId=${selectedProjectId}` : null,
    (url: string) => api.get<EvmHistoryResponse>(url)
  );
  const expensesResponse = useMemo(
    () => (isDemoWorkspace ? getDemoExpensesResponse() : liveExpensesResponse),
    [isDemoWorkspace, liveExpensesResponse]
  );
  const contractsResponse = useMemo(
    () => (isDemoWorkspace ? getDemoContracts() : liveContractsResponse),
    [isDemoWorkspace, liveContractsResponse]
  );
  const evmPortfolio = useMemo(
    () => (isDemoWorkspace ? getDemoPortfolioEvm() : liveEvmPortfolio),
    [isDemoWorkspace, liveEvmPortfolio]
  );
  const scheduledProjects = useMemo(
    () => (isDemoWorkspace ? getDemoProjectsFinanceResponse() : liveScheduledProjects),
    [isDemoWorkspace, liveScheduledProjects]
  );
  const evmHistory = useMemo(
    () =>
      isDemoWorkspace && selectedProjectId
        ? getDemoEvmHistory(selectedProjectId)
        : liveEvmHistory,
    [isDemoWorkspace, liveEvmHistory, selectedProjectId]
  );

  useEffect(() => {
    if (!selectedProjectId && evmPortfolio?.projects.length) {
      setSelectedProjectId(evmPortfolio.projects[0]?.projectId ?? "");
    }
  }, [evmPortfolio?.projects, selectedProjectId]);

  const expenses = useMemo(() => expensesResponse?.expenses ?? [], [expensesResponse?.expenses]);
  const contracts = useMemo(
    () => contractsResponse?.contracts ?? [],
    [contractsResponse?.contracts]
  );

  const metrics = useMemo<FinanceMetric[]>(() => {
    if (!budgetData?.length || !evmPortfolio) {
      return [
        { label: "Общий бюджет", value: "—", status: "info" },
        { label: "Потрачено", value: "—", status: "info" },
        { label: "CPI", value: "—", status: "info" },
        { label: "TCPI", value: "—", status: "info" },
      ];
    }

    const totalPlanned = budgetData.reduce((sum, item) => sum + item.planned, 0);
    const totalActual = budgetData.reduce((sum, item) => sum + item.actual, 0);
    const totalVariance = totalPlanned - totalActual;
    const cpi = evmPortfolio.metrics.CPI;
    const tcpi = evmPortfolio.metrics.TCPI;

    return [
      {
        label: "Общий бюджет",
        value: formatCurrency(totalPlanned, "RUB"),
        status: "info",
      },
      {
        label: "Потрачено",
        value: formatCurrency(totalActual, "RUB"),
        trend: totalVariance >= 0 ? "up" : "down",
        trendValue: `${safePercent(totalActual, totalPlanned)}% от плана`,
        status: totalVariance >= 0 ? "success" : "warning",
      },
      {
        label: "CPI",
        value: cpi.toFixed(2),
        trend: cpi >= 1 ? "up" : "down",
        trendValue: cpi >= 1 ? "Эффективно" : "Перерасход",
        status: cpi >= 1 ? "success" : cpi >= 0.9 ? "warning" : "danger",
      },
      {
        label: "TCPI",
        value: tcpi === null ? "—" : tcpi.toFixed(2),
        trend: tcpi === null ? "neutral" : tcpi <= 1 ? "up" : "down",
        trendValue:
          tcpi === null
            ? "Недостаточно данных"
            : tcpi <= 1
              ? "План достижим"
              : "Нужно ускорение",
        status:
          tcpi === null ? "info" : tcpi <= 1 ? "success" : tcpi <= 1.1 ? "warning" : "danger",
      },
    ];
  }, [budgetData, evmPortfolio]);

  const monthlyCashFlow = useMemo(() => {
    const bucket = new Map<string, { month: string; planned: number; actual: number }>();

    for (const expense of expenses) {
      const month = formatMonthKey(expense.date);
      const current = bucket.get(month) ?? { month, planned: 0, actual: 0 };
      current.actual += expense.amount;
      bucket.set(month, current);
    }

    for (const project of scheduledProjects?.projects ?? []) {
      const budgetPlan = project.budgetPlan ?? 0;
      if (budgetPlan <= 0) continue;

      for (const allocation of distributeBudgetByMonth(project.start, project.end, budgetPlan)) {
        const current = bucket.get(allocation.month) ?? {
          month: allocation.month,
          planned: 0,
          actual: 0,
        };
        current.planned += allocation.amount;
        bucket.set(allocation.month, current);
      }
    }

    return [...bucket.values()]
      .sort((left, right) => left.month.localeCompare(right.month))
      .slice(-8)
      .map((entry) => ({ ...entry, label: formatMonthLabel(entry.month) }));
  }, [expenses, scheduledProjects?.projects]);

  const forecast = useMemo(() => {
    if (!expenses.length) return null;

    const now = Date.now();
    const trailing30 = expenses.filter((expense) => {
      const date = new Date(expense.date).getTime();
      return Number.isFinite(date) && now - date <= 30 * 24 * 60 * 60 * 1000;
    });
    const monthlyBurn = trailing30.reduce((sum, expense) => sum + expense.amount, 0);

    return {
      monthlyBurn,
      nextMonthForecast: monthlyBurn,
      projectedQuarterSpend: monthlyBurn * 3,
      committedContracts: contracts.reduce(
        (sum, contract) => sum + Math.max(contract.amount - contract.paidAmount, 0),
        0
      ),
    };
  }, [contracts, expenses]);

  const projectsAtRisk = useMemo(() => {
    return (evmPortfolio?.projects ?? []).filter(
      (project) => project.metrics.CPI < 0.9 || project.metrics.SPI < 0.9
    );
  }, [evmPortfolio]);

  const topSuppliers = useMemo(() => {
    const supplierMap = new Map<string, { name: string; amount: number; count: number }>();

    for (const expense of expenses) {
      if (!expense.supplier) continue;
      const current = supplierMap.get(expense.supplier.id) ?? {
        name: expense.supplier.name,
        amount: 0,
        count: 0,
      };
      current.amount += expense.amount;
      current.count += 1;
      supplierMap.set(expense.supplier.id, current);
    }

    return [...supplierMap.values()].sort((left, right) => right.amount - left.amount).slice(0, 5);
  }, [expenses]);

  const overdueContracts = useMemo(() => {
    const now = Date.now();

    return contracts
      .filter((contract) => {
        const endTime = new Date(contract.endDate).getTime();
        return Number.isFinite(endTime) && endTime < now && contract.paidAmount < contract.amount;
      })
      .sort(
        (left, right) =>
          new Date(left.endDate).getTime() - new Date(right.endDate).getTime()
      )
      .slice(0, 6);
  }, [contracts]);

  const marginByProject = useMemo(() => {
    return (budgetData ?? [])
      .map((item) => ({
        project: item.project,
        planned: item.planned,
        actual: item.actual,
        margin: item.planned - item.actual,
        marginPercent: item.planned > 0 ? ((item.planned - item.actual) / item.planned) * 100 : 0,
      }))
      .sort((left, right) => left.marginPercent - right.marginPercent)
      .slice(0, 6);
  }, [budgetData]);

  const selectedProjectName = useMemo(
    () =>
      evmPortfolio?.projects.find((project) => project.projectId === selectedProjectId)?.projectName ??
      "—",
    [evmPortfolio?.projects, selectedProjectId]
  );

  const handleExportEVM = async () => {
    if (isDemoWorkspace) {
      alert("В public demo экспорт отключён. Здесь показываем расчёты и поведение cockpit, а не боевые выгрузки.");
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch("/api/finance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: budgetData }),
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const result = (await response.json()) as { downloadUrl?: string };
      if (result.downloadUrl) {
        window.open(result.downloadUrl, "_blank");
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Ошибка экспорта. Проверьте консоль для деталей.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!selectedProjectId) return;
    if (isDemoWorkspace) {
      alert("Public demo работает в режиме read-only. Сохранение EVM snapshot доступно только в приватном кабинете.");
      return;
    }

    setIsSavingSnapshot(true);
    try {
      await api.post("/api/evm/snapshot", { projectId: selectedProjectId });
      await Promise.all([refreshHistory(), refreshEvm()]);
    } catch (error) {
      console.error("EVM snapshot save failed:", error);
      alert("Не удалось сохранить EVM snapshot. Проверьте консоль.");
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6 py-6" data-testid="finance-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Финансовый cockpit</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Бюджет, cash flow, EVM-тренд, поставщики и контроль обязательств
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSaveSnapshot}
            disabled={!selectedProjectId || isSavingSnapshot}
            variant="outline"
            className="gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            {isSavingSnapshot ? "Сохраняем..." : "Сохранить EVM snapshot"}
          </Button>
          <Button onClick={handleExportEVM} disabled={isExporting || isLoading || evmLoading} className="gap-2">
            <Download className="h-4 w-4" />
            {isExporting ? "Экспорт..." : "Экспорт EVM в Excel"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <FinanceMetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {projectsAtRisk.length ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-lg">Проекты с риском перерасхода или срыва</CardTitle>
            </div>
            <CardDescription>
              {projectsAtRisk.length} проектов имеют CPI или SPI ниже 0.9
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectsAtRisk.slice(0, 5).map((item) => (
                <div
                  key={item.projectId}
                  className="flex items-center justify-between rounded-lg bg-white/50 p-3"
                >
                  <div>
                    <p className="font-medium text-[var(--ink)]">{item.projectName}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      CPI {item.metrics.CPI.toFixed(2)} · SPI {item.metrics.SPI.toFixed(2)} ·{" "}
                      {item.source === "task_costs" ? "по задачам" : "по бюджету проекта"}
                    </p>
                  </div>
                  <Badge variant="danger">
                    {Math.min(item.metrics.CPI, item.metrics.SPI).toFixed(2)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {expensesResponse?.summary ? <ExpenseSummary summary={expensesResponse.summary} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Cash flow: план vs факт
            </CardTitle>
            <CardDescription>
              План распределён по календарю проектов, факт — по зарегистрированным расходам
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px] min-w-0">
            <ClientChart className="h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCashFlow}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={formatCompactCurrency} />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? formatCurrency(value, "RUB") : String(value ?? "—")
                    }
                  />
                  <Legend />
                  <Bar dataKey="planned" fill="#0ea5e9" name="План" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#8b5cf6" name="Факт" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ClientChart>
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Burn rate и прогноз
            </CardTitle>
            <CardDescription>
              Скользящий 30-дневный расход и ближайшая финансовая нагрузка
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile
                label="Burn rate / 30 дней"
                value={forecast ? formatCurrency(forecast.monthlyBurn) : "—"}
              />
              <StatTile
                label="Прогноз на 30 дней"
                value={forecast ? formatCurrency(forecast.nextMonthForecast) : "—"}
              />
              <StatTile
                label="Прогноз на квартал"
                value={forecast ? formatCurrency(forecast.projectedQuarterSpend) : "—"}
              />
              <StatTile
                label="Неоплаченные обязательства"
                value={forecast ? formatCurrency(forecast.committedContracts) : "—"}
              />
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)]/40 p-4 text-sm text-[var(--ink-muted)]">
              Текущий портфельный EAC:{" "}
              <span className="font-semibold text-[var(--ink)]">
                {evmPortfolio ? formatCurrency(evmPortfolio.metrics.EAC) : "—"}
              </span>
              {" · "}
              VAC:{" "}
              <span
                className={
                  evmPortfolio && evmPortfolio.metrics.VAC < 0 ? "text-rose-600" : "text-emerald-600"
                }
              >
                {evmPortfolio ? formatCurrency(evmPortfolio.metrics.VAC) : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LineChartIcon className="h-5 w-5" />
              EVM S-кривая
            </CardTitle>
            <CardDescription>
              Исторические snapshots по проекту {selectedProjectName}
            </CardDescription>
          </div>
          <select
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-3 text-sm text-[var(--ink)]"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            <option value="">Выберите проект…</option>
            {(evmPortfolio?.projects ?? []).map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.projectName}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="min-h-[320px] min-w-0">
          {evmHistory?.snapshots.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={evmHistory.snapshots.map((snapshot) => ({
                  label: new Date(snapshot.date).toLocaleDateString("ru-RU", {
                    month: "short",
                    day: "numeric",
                  }),
                  PV: snapshot.pv,
                  EV: snapshot.ev,
                  AC: snapshot.ac,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={formatCompactCurrency} />
                <Tooltip
                  formatter={(value) =>
                    typeof value === "number" ? formatCurrency(value, "RUB") : String(value ?? "—")
                  }
                />
                <Legend />
                <Line type="monotone" dataKey="PV" stroke="#0ea5e9" strokeWidth={2} name="PV" />
                <Line type="monotone" dataKey="EV" stroke="#10b981" strokeWidth={2} name="EV" />
                <Line type="monotone" dataKey="AC" stroke="#f97316" strokeWidth={2} name="AC" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/30 text-center">
              <p className="max-w-md text-sm text-[var(--ink-muted)]">
                Пока нет исторических EVM snapshots. Сохраните первый snapshot для выбранного проекта,
                чтобы включить S-кривую и тренд CPI/SPI.
              </p>
              <Button
                onClick={handleSaveSnapshot}
                disabled={!selectedProjectId || isSavingSnapshot}
                variant="outline"
              >
                {isSavingSnapshot ? "Сохраняем..." : "Создать первый snapshot"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Top-5 поставщиков</CardTitle>
            <CardDescription>По объёму расходов из фактических проводок</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topSuppliers.length ? (
              topSuppliers.map((supplier, index) => (
                <div
                  key={supplier.name}
                  className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">
                      #{index + 1} {supplier.name}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {supplier.count} документов
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-[var(--ink)]">
                    {formatCurrency(supplier.amount)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-[var(--ink-muted)]">Нет связанных расходов по поставщикам.</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Просроченные оплаты</CardTitle>
            <CardDescription>Договоры, где срок завершения прошёл, а оплата не закрыта</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overdueContracts.length ? (
              overdueContracts.map((contract) => (
                <div
                  key={contract.id}
                  className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-[var(--ink)]">
                      {contract.number} · {contract.title}
                    </div>
                    <Badge variant="danger">
                      {safePercent(contract.paidAmount, contract.amount)}%
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-muted)]">
                    {contract.supplier.name} · {contract.project.name} · закрытие{" "}
                    {new Date(contract.endDate).toLocaleDateString("ru-RU")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-rose-600">
                    Остаток {formatCurrency(contract.amount - contract.paidAmount, contract.currency)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-[var(--ink-muted)]">Просроченных оплат не найдено.</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Маржа по проектам</CardTitle>
            <CardDescription>Где портфель теряет запас быстрее всего</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {marginByProject.map((item) => {
              const usage = safePercent(item.actual, item.planned);
              return (
                <div key={item.project} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-[var(--ink)]">{item.project}</div>
                    <div className={item.margin < 0 ? "text-rose-600" : "text-emerald-600"}>
                      {formatCurrency(item.margin)}
                    </div>
                  </div>
                  <Progress value={Math.min(usage, 100)} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>{usage}% бюджета использовано</span>
                    <span>{item.marginPercent.toFixed(1)}% запас</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {!isLoading && !evmLoading && (!budgetData || budgetData.length === 0) ? (
        <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]">
          <CardContent className="py-12 text-center">
            <DollarSign className="mx-auto h-12 w-12 text-[var(--ink-muted)] opacity-50" />
            <p className="mt-4 text-[var(--ink-muted)]">
              Нет данных о бюджете. Добавьте проекты с бюджетом.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function formatMonthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
}

function distributeBudgetByMonth(start: string, end: string, budgetPlan: number) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [];
  }

  const totalDays = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
  const dayRate = budgetPlan / totalDays;
  const allocations = new Map<string, number>();
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    allocations.set(key, (allocations.get(key) ?? 0) + dayRate);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [...allocations.entries()].map(([month, amount]) => ({ month, amount }));
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
