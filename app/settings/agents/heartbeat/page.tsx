"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AgentOption = {
  id: string;
  name: string;
  role: string;
};

type ActivityEvent = {
  type: string;
  content: string;
  createdAt: string;
};

type ActivityItem = {
  id: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  status: string;
  invocationSource: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  eventCount: number;
  latestEvents: ActivityEvent[];
  usageJson: {
    tokens?: number;
    costUsd?: number;
    model?: string;
    provider?: string;
    durationMs?: number;
  } | null;
};

type ActivityResponse = {
  items: ActivityItem[];
  stats: Record<string, number>;
};

type DeadLetterItem = {
  id: string;
  agentName: string;
  agentRole: string;
  runId: string | null;
  reason: string;
  errorType: string;
  errorMessage: string;
  attempts: number;
  createdAt: string;
};

const STATUS_VARIANTS: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  succeeded: "success",
  failed: "danger",
  timed_out: "danger",
  cancelled: "warning",
  running: "info",
  queued: "neutral",
};

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = Math.max(end - start, 0);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function HeartbeatMonitorPage() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({ limit: "40" });
      if (statusFilter) params.set("status", statusFilter);
      if (agentFilter) params.set("agentId", agentFilter);

      const [activityRes, agentsRes, dlqRes] = await Promise.all([
        fetch(`/api/orchestration/activity?${params.toString()}`),
        fetch("/api/orchestration/agents"),
        fetch("/api/orchestration/dlq?limit=6"),
      ]);

      const [activityData, agentsData, dlqData]: [
        ActivityResponse,
        { agents?: AgentOption[] },
        { items?: DeadLetterItem[] }
      ] = await Promise.all([activityRes.json(), agentsRes.json(), dlqRes.json()]);

      setItems(activityData.items ?? []);
      setStats(activityData.stats ?? {});
      setDeadLetters(dlqData.items ?? []);
      setAgents(
        (agentsData.agents ?? []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        }))
      );
    } catch {
      toast.error("Failed to load heartbeat monitor");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentFilter, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const orderedStats = useMemo(
    () => [
      ["running", stats.running ?? 0],
      ["queued", stats.queued ?? 0],
      ["succeeded", stats.succeeded ?? 0],
      ["failed", (stats.failed ?? 0) + (stats.timed_out ?? 0)],
    ],
    [stats]
  );

  return (
    <div className="grid gap-4">
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
          <h1
            className="flex items-center gap-2 text-lg font-semibold"
            style={{ color: "var(--ink)" }}
          >
            <Activity size={20} /> Heartbeat Monitor
          </h1>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
        <select
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="timed_out">Timed out</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
          value={agentFilter}
          onChange={(event) => setAgentFilter(event.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.role})
            </option>
          ))}
        </select>

        <Button
          variant={autoRefresh ? "default" : "outline"}
          onClick={() => setAutoRefresh((value) => !value)}
        >
          {autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
        </Button>

        <Button variant="outline" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw
            size={14}
            className={`mr-2 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {orderedStats.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
                {label}
              </p>
              <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--ink)" }}>
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dead-letter queue</CardTitle>
        </CardHeader>
        <CardContent>
          {deadLetters.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No open dead-letter jobs.
            </p>
          ) : (
            <div className="grid gap-3">
              {deadLetters.map((item) => (
                <div
                  key={item.id}
                  className="rounded border p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="danger" className="text-xs">
                      {item.errorType}
                    </Badge>
                    <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {item.agentName}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {item.agentRole} · {item.reason} · attempt {item.attempts}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                    {item.errorMessage}
                  </p>
                  {item.runId ? (
                    <Link
                      href={`/settings/agents/runs/${item.runId}`}
                      className="mt-2 inline-block text-xs underline"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      Open failed run
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              Loading heartbeat activity…
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No heartbeat runs for the current filters.
            </p>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={`/settings/agents/runs/${item.id}`}
                  className="rounded border p-4 transition-colors hover:bg-[var(--panel-soft)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={STATUS_VARIANTS[item.status] ?? "neutral"}
                      className="text-xs"
                    >
                      {item.status}
                    </Badge>
                    <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {item.agentName}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {item.agentRole} · {item.invocationSource}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div
                    className="mt-3 grid gap-2 text-xs sm:grid-cols-4"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    <span>Duration: {formatDuration(item.startedAt, item.finishedAt)}</span>
                    <span>Events: {item.eventCount}</span>
                    <span>Tokens: {item.usageJson?.tokens ?? 0}</span>
                    <span>
                      Cost: $
                      {typeof item.usageJson?.costUsd === "number"
                        ? item.usageJson.costUsd.toFixed(4)
                        : "0.0000"}
                    </span>
                  </div>

                  {item.latestEvents.length > 0 && (
                    <div className="mt-3 grid gap-1">
                      {item.latestEvents.map((event, index) => (
                        <div
                          key={`${item.id}-${event.createdAt}-${index}`}
                          className="flex gap-2 text-xs"
                          style={{ color: "var(--ink-soft)" }}
                        >
                          <span className="shrink-0 uppercase">{event.type}</span>
                          <span className="truncate">{event.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
