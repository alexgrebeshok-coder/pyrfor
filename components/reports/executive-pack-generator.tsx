"use client";

import { useState } from "react";

interface ReportSummary {
  projectCount: number;
  avgProgress: number;
  totalBudgetPlan: number;
  totalBudgetFact: number;
  budgetUtilization: number;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  openRisks: number;
  criticalRisks: number;
  pendingApprovals: number;
}

interface ExecutiveReport {
  generatedAt: string;
  period: string;
  summary: ReportSummary;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    health: string;
    progress: number;
    budgetPlan: number | null;
    budgetFact: number | null;
    taskCount: number;
    openRiskCount: number;
  }>;
}

type Period = "week" | "month" | "quarter";

export function ExecutivePackGenerator() {
  const [report, setReport] = useState<ExecutiveReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>("week");

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/executive-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      }
    } finally {
      setLoading(false);
    }
  };

  const printReport = () => {
    window.print();
  };

  const periodLabels: Record<Period, string> = {
    week: "Неделя",
    month: "Месяц",
    quarter: "Квартал",
  };

  const healthEmoji = (health: string) => {
    switch (health) {
      case "good": return "🟢";
      case "warning": case "needs_attention": return "🟡";
      case "critical": case "at_risk": return "🔴";
      default: return "⚪";
    }
  };

  const fmtMoney = (v: number | null) =>
    v != null ? `${(v / 1_000_000).toFixed(1)}M ₽` : "—";

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h2 className="text-xl font-semibold">Executive Pack</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["week", "month", "quarter"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                period === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Генерация..." : "Сгенерировать"}
        </button>
        {report && (
          <button
            onClick={printReport}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            🖨️ Печать / PDF
          </button>
        )}
      </div>

      {/* Report */}
      {report && (
        <div className="space-y-6 rounded-xl border bg-card p-6 shadow-sm print:border-none print:shadow-none">
          <div className="border-b pb-4">
            <h1 className="text-2xl font-bold">CEOClaw Executive Pack</h1>
            <p className="text-sm text-muted-foreground">
              Период: {periodLabels[report.period as Period]} •{" "}
              Сгенерировано: {new Date(report.generatedAt).toLocaleString("ru-RU")}
            </p>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Проекты", value: report.summary.projectCount },
              { label: "Средний прогресс", value: `${report.summary.avgProgress}%` },
              { label: "Бюджет план", value: fmtMoney(report.summary.totalBudgetPlan) },
              { label: "Бюджет факт", value: fmtMoney(report.summary.totalBudgetFact) },
              { label: "Освоение", value: `${report.summary.budgetUtilization}%` },
              { label: "Задачи за период", value: report.summary.totalTasks },
              { label: "Завершено", value: `${report.summary.completedTasks} (${report.summary.completionRate}%)` },
              { label: "Открытые риски", value: report.summary.openRisks },
              { label: "Критические риски", value: report.summary.criticalRisks },
              { label: "Согласования", value: report.summary.pendingApprovals },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">{kpi.label}</div>
                <div className="mt-1 text-lg font-semibold">{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Projects Table */}
          <div>
            <h3 className="mb-3 font-semibold">Проекты</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2">Проект</th>
                    <th className="pb-2">Здоровье</th>
                    <th className="pb-2">Прогресс</th>
                    <th className="pb-2">Бюджет</th>
                    <th className="pb-2">Задачи</th>
                    <th className="pb-2">Риски</th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="py-2">{healthEmoji(p.health)} {p.health}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${p.progress}%` }}
                            />
                          </div>
                          <span>{p.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2">{fmtMoney(p.budgetFact)} / {fmtMoney(p.budgetPlan)}</td>
                      <td className="py-2">{p.taskCount}</td>
                      <td className="py-2">{p.openRiskCount > 0 ? `⚠️ ${p.openRiskCount}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="py-12 text-center text-muted-foreground">
          Нажмите «Сгенерировать» чтобы создать отчёт
        </div>
      )}
    </div>
  );
}
