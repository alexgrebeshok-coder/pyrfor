"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Bot, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──

type AgentStat = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  runtimeState: {
    totalRuns: number;
    successfulRuns: number;
    totalTokens: number;
    totalCostCents: number;
    lastHeartbeatAt: string | null;
    lastError: string | null;
  } | null;
};

type ActivityItem = {
  id: string;
  agentName: string;
  agentRole: string;
  status: string;
  invocationSource: string;
  createdAt: string;
  finishedAt: string | null;
  usageJson: { tokens?: number; costUsd?: number } | null;
};

function formatCents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

// ── Page ──

export default function AgentDashboardPage() {
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, activityRes] = await Promise.all([
        fetch("/api/orchestration/agents"),
        fetch("/api/orchestration/activity?limit=15"),
      ]);
      const [agentsData, activityData] = await Promise.all([
        agentsRes.json(),
        activityRes.json(),
      ]);
      setAgents(agentsData.agents ?? []);
      setActivity(activityData.items ?? []);
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate stats
  const totalAgents = agents.length;
  const activeAgents = agents.filter((a) => a.status === "running").length;
  const totalRuns = agents.reduce((s, a) => s + (a.runtimeState?.totalRuns ?? 0), 0);
  const successfulRuns = agents.reduce((s, a) => s + (a.runtimeState?.successfulRuns ?? 0), 0);
  const totalTokens = agents.reduce((s, a) => s + (a.runtimeState?.totalTokens ?? 0), 0);
  const totalCostCents = agents.reduce((s, a) => s + (a.runtimeState?.totalCostCents ?? 0), 0);
  const totalBudgetCents = agents.reduce((s, a) => s + a.budgetMonthlyCents, 0);
  const totalSpentCents = agents.reduce((s, a) => s + a.spentMonthlyCents, 0);
  const successRate = totalRuns > 0 ? ((successfulRuns / totalRuns) * 100).toFixed(1) : "—";

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
          Loading dashboard…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Header */}
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-4 p-6">
          <Link
            href="/settings/agents"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            <ArrowLeft size={16} /> Agents
          </Link>
          <div className="flex-1" />
          <h1 className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--ink)" }}>
            <BarChart3 size={20} /> Agent Dashboard
          </h1>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Agents" value={String(totalAgents)} sub={`${activeAgents} active`} />
        <StatCard label="Total Runs" value={String(totalRuns)} sub={`${successRate}% success`} />
        <StatCard label="Tokens Used" value={totalTokens.toLocaleString()} sub={`${formatCents(totalCostCents)} total cost`} />
        <StatCard
          label="Monthly Budget"
          value={formatCents(totalSpentCents)}
          sub={totalBudgetCents > 0 ? `of ${formatCents(totalBudgetCents)} budget` : "no budget set"}
        />
      </div>

      {/* Top Agents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={16} /> Agent Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--ink-muted)" }}>
                  <th className="px-2 py-1 text-left font-medium">Agent</th>
                  <th className="px-2 py-1 text-left font-medium">Role</th>
                  <th className="px-2 py-1 text-right font-medium">Runs</th>
                  <th className="px-2 py-1 text-right font-medium">Success</th>
                  <th className="px-2 py-1 text-right font-medium">Tokens</th>
                  <th className="px-2 py-1 text-right font-medium">Cost</th>
                  <th className="px-2 py-1 text-right font-medium">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {agents
                  .sort(
                    (a, b) =>
                      (b.runtimeState?.totalRuns ?? 0) -
                      (a.runtimeState?.totalRuns ?? 0)
                  )
                  .map((agent) => {
                    const rs = agent.runtimeState;
                    const sr =
                      rs && rs.totalRuns > 0
                        ? `${((rs.successfulRuns / rs.totalRuns) * 100).toFixed(0)}%`
                        : "—";
                    return (
                      <tr
                        key={agent.id}
                        className="border-t"
                        style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                      >
                        <td className="px-2 py-2 font-medium">{agent.name}</td>
                        <td className="px-2 py-2">
                          <Badge variant="neutral" className="text-xs">
                            {agent.role}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right">{rs?.totalRuns ?? 0}</td>
                        <td className="px-2 py-2 text-right">{sr}</td>
                        <td className="px-2 py-2 text-right">
                          {(rs?.totalTokens ?? 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatCents(rs?.totalCostCents ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--ink-muted)" }}>
                          {rs?.lastHeartbeatAt
                            ? new Date(rs.lastHeartbeatAt).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot size={16} /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>No activity yet</p>
          ) : (
            <div className="grid gap-2">
              {activity.map((item) => (
                <Link
                  key={item.id}
                  href={`/settings/agents/runs/${item.id}`}
                  className="flex items-center gap-3 rounded border px-3 py-2 transition-colors hover:bg-[var(--panel-soft)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Badge
                    variant={
                      item.status === "succeeded"
                        ? "success"
                        : item.status === "failed"
                          ? "danger"
                          : item.status === "running"
                            ? "info"
                            : "neutral"
                    }
                    className="shrink-0 text-xs"
                  >
                    {item.status}
                  </Badge>
                  <span className="flex-1 text-sm" style={{ color: "var(--ink)" }}>
                    {item.agentName}{" "}
                    <span style={{ color: "var(--ink-muted)" }}>({item.invocationSource})</span>
                  </span>
                  {item.usageJson?.tokens && (
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {item.usageJson.tokens} tok
                    </span>
                  )}
                  <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Stat Card ──

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold" style={{ color: "var(--ink)" }}>
          {value}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-soft)" }}>
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}
