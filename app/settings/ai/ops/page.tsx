"use client";

/**
 * AI Ops dashboard — surfaces the read-only snapshot returned by
 * `/api/ai/ops` (see `app/api/ai/ops/route.ts`). Shows current server AI
 * mode, per-provider circuit breaker state, today's cost posture, available
 * providers/models, and recent agent-bus persist failures.
 *
 * Workspace-scoped; requires RUN_AI_ACTIONS permission on the backend.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Activity, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CircuitBreakerSnapshot {
  name: string;
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailureTime: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejections: number;
}

interface BudgetAlert {
  workspaceId: string;
  severity: "warning" | "breach";
  threshold: number;
  totalUsdToday: number;
  dailyLimitUsd: number;
  utilization: number;
  triggeredBy: {
    agentId?: string;
    runId?: string;
    provider: string;
    model: string;
    costUsd: number;
  };
  at: string;
}

interface BudgetWebhookDelivery {
  url: string;
  status: number;
  ok: boolean;
  attempts: number;
  error?: string;
}

interface CostWebhookStatus {
  configured: boolean;
  recentDeliveries: BudgetWebhookDelivery[];
}

interface BudgetMirrorDelivery {
  target: "sentry" | "datadog";
  ok: boolean;
  status: number;
  attempts: number;
  error?: string;
  workspaceId: string;
  severity: "warning" | "breach";
}

interface CostMirrorStatus {
  configured: { sentry: boolean; datadog: boolean };
  recentDeliveries: BudgetMirrorDelivery[];
}

interface CostPosture {
  workspaceId: string;
  totalUsdToday: number;
  dailyLimitUsd: number;
  utilization: number;
  remainingUsd: number;
  recordCount: number;
  breachedAt: string | null;
  recentAlerts?: BudgetAlert[];
  webhook?: CostWebhookStatus;
  mirror?: CostMirrorStatus;
}

interface AgentBusPersistError {
  at: string;
  error: string;
  type: string;
  source: string;
  runId?: string;
  workspaceId?: string;
}

interface OpsSnapshot {
  generatedAt: string;
  workspaceId: string;
  status: {
    mode: "gateway" | "provider" | "mock" | "unavailable";
    gatewayKind?: "local" | "remote" | "missing";
    gatewayAvailable?: boolean;
    providerAvailable?: boolean;
    isProduction?: boolean;
    unavailableReason?: string | null;
  };
  providers: {
    available: string[];
    models: Record<string, string[]>;
  };
  circuitBreakers: CircuitBreakerSnapshot[];
  cost: CostPosture;
  bus: {
    recentPersistErrors: AgentBusPersistError[];
  };
}

const REFRESH_INTERVAL_MS = 30_000;

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatPercent(value: number): string {
  return `${(Math.min(value, 1) * 100).toFixed(1)}%`;
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function modeBadge(mode: OpsSnapshot["status"]["mode"]) {
  switch (mode) {
    case "gateway":
      return <Badge className="bg-emerald-600">gateway</Badge>;
    case "provider":
      return <Badge className="bg-blue-600">provider</Badge>;
    case "mock":
      return <Badge variant="neutral">mock</Badge>;
    case "unavailable":
      return <Badge variant="danger">unavailable</Badge>;
    default:
      return <Badge variant="neutral">{mode}</Badge>;
  }
}

function circuitStateBadge(state: CircuitBreakerSnapshot["state"]) {
  if (state === "closed") return <Badge className="bg-emerald-600">closed</Badge>;
  if (state === "half-open") return <Badge className="bg-amber-500">half-open</Badge>;
  return <Badge variant="danger">open</Badge>;
}

export default function AIOpsPage() {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/ai/ops?busLimit=50", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as OpsSnapshot;
      setSnapshot(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    timerRef.current = setInterval(() => void refresh(false), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  const costColor = useMemo(() => {
    if (!snapshot) return "bg-muted";
    const u = snapshot.cost.utilization;
    if (u >= 0.9) return "bg-red-500";
    if (u >= 0.7) return "bg-amber-500";
    return "bg-emerald-500";
  }, [snapshot]);

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings/ai">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              AI Settings
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            AI Ops
          </h1>
        </div>
        <Button
          onClick={() => void refresh(true)}
          disabled={refreshing}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-red-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Failed to load AI ops snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-all text-sm">{error}</pre>
          </CardContent>
        </Card>
      )}

      {snapshot && snapshot.cost.utilization >= 0.8 && (
        <Card
          className={`mb-6 ${
            snapshot.cost.utilization >= 1
              ? "border-red-500/60 bg-red-500/5"
              : "border-amber-500/60 bg-amber-500/5"
          }`}
        >
          <CardHeader>
            <CardTitle
              className={`flex items-center gap-2 ${
                snapshot.cost.utilization >= 1 ? "text-red-600" : "text-amber-700"
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
              {snapshot.cost.utilization >= 1
                ? "Daily AI budget exceeded"
                : "Approaching daily AI budget"}
            </CardTitle>
            <CardDescription>
              Spent {formatUsd(snapshot.cost.totalUsdToday)} of{" "}
              {formatUsd(snapshot.cost.dailyLimitUsd)} ({formatPercent(snapshot.cost.utilization)}).
              {snapshot.cost.utilization >= 1
                ? " New AI runs are being rejected by the cost guard until midnight UTC."
                : " New AI runs are still allowed; raise AI_DAILY_COST_LIMIT or slow down usage."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {loading && !snapshot ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading AI kernel snapshot…
          </CardContent>
        </Card>
      ) : null}

      {snapshot && (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Kernel status</span>
                {modeBadge(snapshot.status.mode)}
              </CardTitle>
              <CardDescription>
                Generated at {formatDateTime(snapshot.generatedAt)} · workspace {snapshot.workspaceId}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Gateway:</span>{" "}
                {snapshot.status.gatewayKind ?? "unknown"} ·{" "}
                {snapshot.status.gatewayAvailable ? "available" : "unavailable"}
              </div>
              <div>
                <span className="text-muted-foreground">Provider available:</span>{" "}
                {snapshot.status.providerAvailable ? "yes" : "no"} ·{" "}
                <span className="text-muted-foreground">production:</span>{" "}
                {snapshot.status.isProduction ? "yes" : "no"}
              </div>
              {snapshot.status.unavailableReason && (
                <div className="text-red-600">
                  <span className="text-muted-foreground">Unavailable reason:</span>{" "}
                  {snapshot.status.unavailableReason}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily cost posture</CardTitle>
              <CardDescription>
                {formatUsd(snapshot.cost.totalUsdToday)} spent today (
                {snapshot.cost.recordCount} runs) of {formatUsd(snapshot.cost.dailyLimitUsd)} daily
                limit
                {snapshot.cost.breachedAt
                  ? ` · breached at ${formatDateTime(snapshot.cost.breachedAt)}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${costColor}`}
                  style={{ width: `${Math.min(snapshot.cost.utilization, 1) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatPercent(snapshot.cost.utilization)} utilisation</span>
                <span>{formatUsd(snapshot.cost.remainingUsd)} remaining</span>
              </div>
            </CardContent>
          </Card>

          {snapshot.cost.webhook && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Budget alert webhook</span>
                  {snapshot.cost.webhook.configured ? (
                    <Badge className="bg-emerald-600">configured</Badge>
                  ) : (
                    <Badge variant="neutral">not configured</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Slack-compatible webhook subscribed to <code>budget.alert</code> events.
                  Set <code>BUDGET_ALERT_WEBHOOK_URL</code> to enable delivery.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!snapshot.cost.webhook.configured ? (
                  <div className="text-sm text-muted-foreground">
                    Webhook is disabled. No alerts will be forwarded to Slack/Mattermost/Discord
                    until the env var is set and the server restarts.
                  </div>
                ) : snapshot.cost.webhook.recentDeliveries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No deliveries yet. The first delivery will appear once a budget threshold
                    (80% or 100%) is crossed.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.cost.webhook.recentDeliveries.map((d, i) => (
                      <div
                        key={`${d.url}-${i}`}
                        className={`rounded border p-2 text-xs ${
                          d.ok
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-red-500/40 bg-red-500/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant={d.ok ? "success" : "danger"}>
                            {d.ok ? "delivered" : "failed"} · {d.status || "—"}
                          </Badge>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            attempts: {d.attempts}
                          </span>
                        </div>
                        {d.error && (
                          <div className="mt-1 break-words text-red-600">{d.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {snapshot.cost.mirror && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Budget alert mirror</span>
                  <div className="flex gap-2">
                    {snapshot.cost.mirror.configured.sentry ? (
                      <Badge className="bg-purple-600">sentry</Badge>
                    ) : (
                      <Badge variant="neutral">sentry off</Badge>
                    )}
                    {snapshot.cost.mirror.configured.datadog ? (
                      <Badge className="bg-indigo-600">datadog</Badge>
                    ) : (
                      <Badge variant="neutral">datadog off</Badge>
                    )}
                  </div>
                </CardTitle>
                <CardDescription>
                  Parallel fan-out of `budget.alert` to Sentry and/or Datadog so the
                  primary webhook isn&apos;t a single point of failure. Opt-in via
                  `BUDGET_ALERT_SENTRY_DSN` / `BUDGET_ALERT_DATADOG_API_KEY`.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!snapshot.cost.mirror.configured.sentry &&
                !snapshot.cost.mirror.configured.datadog ? (
                  <div className="text-sm text-muted-foreground">
                    No mirror targets configured. Alerts are only persisted in the local
                    ring buffer and the primary webhook above.
                  </div>
                ) : snapshot.cost.mirror.recentDeliveries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Mirror is wired but has not received an alert yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.cost.mirror.recentDeliveries.map((d, i) => (
                      <div
                        key={`${d.target}-${d.workspaceId}-${i}`}
                        className={`rounded border p-2 text-xs ${
                          d.ok
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-red-500/40 bg-red-500/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge
                              className={
                                d.target === "sentry" ? "bg-purple-600" : "bg-indigo-600"
                              }
                            >
                              {d.target}
                            </Badge>
                            <span className="font-mono">{d.workspaceId}</span>
                            <Badge
                              variant={d.severity === "breach" ? "danger" : "warning"}
                            >
                              {d.severity}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono">HTTP {d.status}</span>
                            <span className="text-muted-foreground">
                              {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                        {d.error && (
                          <div className="mt-1 break-words text-red-600">{d.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {snapshot.cost.recentAlerts && snapshot.cost.recentAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent budget alerts</CardTitle>
                <CardDescription>
                  Threshold crossings emitted on the agent bus (`budget.alert`). Each
                  workspace/day/threshold is fired at most once.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {snapshot.cost.recentAlerts.map((a, i) => (
                  <div
                    key={`${a.at}-${a.threshold}-${i}`}
                    className={`rounded border p-2 text-xs ${
                      a.severity === "breach"
                        ? "border-red-500/40 bg-red-500/5"
                        : "border-amber-500/40 bg-amber-500/5"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={a.severity === "breach" ? "danger" : "warning"}
                      >
                        {a.severity} · {Math.round(a.threshold * 100)}%
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatDateTime(a.at)}
                      </span>
                    </div>
                    <div className="mt-1">
                      {formatUsd(a.totalUsdToday)} of {formatUsd(a.dailyLimitUsd)} (
                      {formatPercent(a.utilization)})
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      triggered by {a.triggeredBy.provider}/{a.triggeredBy.model}
                      {a.triggeredBy.agentId ? ` · agent:${a.triggeredBy.agentId}` : ""}
                      {a.triggeredBy.runId ? ` · run:${a.triggeredBy.runId.slice(0, 8)}` : ""}
                      {" · "}
                      {formatUsd(a.triggeredBy.costUsd)} this call
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Provider circuit breakers</CardTitle>
              <CardDescription>
                Live state from the shared AIRouter — open breakers short-circuit until the probe
                succeeds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.circuitBreakers.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No breakers tripped yet. State appears after the first call.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="pb-2">Provider</th>
                        <th className="pb-2">State</th>
                        <th className="pb-2 text-right">Failures</th>
                        <th className="pb-2 text-right">Successes</th>
                        <th className="pb-2 text-right">Rejections</th>
                        <th className="pb-2">Last failure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.circuitBreakers.map((snap) => (
                        <tr key={snap.name} className="border-t">
                          <td className="py-2 font-mono">{snap.name}</td>
                          <td className="py-2">{circuitStateBadge(snap.state)}</td>
                          <td className="py-2 text-right">{snap.totalFailures}</td>
                          <td className="py-2 text-right">{snap.totalSuccesses}</td>
                          <td className="py-2 text-right">{snap.totalRejections}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {snap.lastFailureTime
                              ? new Date(snap.lastFailureTime).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Available providers & models</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshot.providers.available.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No providers configured on the server.
                </div>
              ) : (
                snapshot.providers.available.map((p) => (
                  <div key={p} className="border-l-2 border-primary pl-3">
                    <div className="font-mono text-sm">{p}</div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(snapshot.providers.models[p] ?? []).map((m) => (
                        <Badge key={m} variant="neutral" className="font-mono text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent agent-bus persist errors</CardTitle>
              <CardDescription>
                Best-effort ring buffer (max 100). Errors here indicate the agent bus could not
                write to the `agent_messages` table — messages were still delivered in-process.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.bus.recentPersistErrors.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No recent persist errors. The agent bus is healthy.
                </div>
              ) : (
                <div className="space-y-2">
                  {snapshot.bus.recentPersistErrors.map((e, i) => (
                    <div
                      key={`${e.at}-${i}`}
                      className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {formatDateTime(e.at)}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {e.type} · {e.source}
                        </span>
                      </div>
                      <div className="mt-1 break-words">{e.error}</div>
                      {(e.runId || e.workspaceId) && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {e.runId ? `run:${e.runId.slice(0, 8)}` : ""}
                          {e.workspaceId ? ` · ws:${e.workspaceId}` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
