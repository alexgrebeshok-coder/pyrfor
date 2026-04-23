/**
 * /agents — operational agents list
 *
 * Sprint 2 first page: foundation for orchestration UI.
 * Shows all agents in the workspace with their live operational status:
 * status, circuit state, last heartbeat, budget consumption, run counts.
 *
 * Server component — fetches directly via agent-service (no extra HTTP hop).
 */
import Link from "next/link";
import { Activity, AlertCircle, Bot, Clock, DollarSign, RefreshCw, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAgents } from "@/lib/orchestration/agent-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];

function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  const variant: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
    active: "success",
    idle: "neutral",
    paused: "warning",
    failed: "danger",
    archived: "neutral",
  };
  return (
    <Badge variant={variant[status] ?? "neutral"} className="capitalize">
      {status}
    </Badge>
  );
}

function circuitBadge(state: string | undefined) {
  if (!state) return <span className="text-muted-foreground text-xs">—</span>;
  const tone: "danger" | "warning" | "neutral" =
    state === "open" ? "danger" : state === "half_open" ? "warning" : "neutral";
  return (
    <Badge variant={tone} className="text-xs">
      {state}
    </Badge>
  );
}

async function getAgents(workspaceId: string): Promise<AgentRow[]> {
  try {
    return await listAgents(workspaceId, { includeState: true });
  } catch (error) {
    console.error("[agents page] Failed to load agents", error);
    return [];
  }
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.workspace ?? "executive";
  const agents = await getAgents(workspaceId);

  const totals = {
    count: agents.length,
    active: agents.filter((a) => a.status === "active").length,
    failing: agents.filter(
      (a) => (a.runtimeState?.consecutiveFailures ?? 0) > 0
    ).length,
    spentCents: agents.reduce(
      (sum, a) => sum + (a.runtimeState?.totalCostCents ?? 0),
      0
    ),
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="w-8 h-8" />
            Agents
          </h1>
          <p className="text-muted-foreground mt-1">
            Operational view — workspace <code>{workspaceId}</code>
          </p>
        </div>
        <Link
          href="/settings/agents"
          className="text-sm text-primary hover:underline"
        >
          Manage agents →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" />
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Failing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.failing}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Spent (mo)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCents(totals.spentCents)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {agents.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bot className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No agents in workspace <code>{workspaceId}</code>.</p>
              <Link
                href="/settings/agents"
                className="text-primary hover:underline text-sm mt-2 inline-block"
              >
                Create the first agent →
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Circuit</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last Heartbeat
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Runs
                    </span>
                  </TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => {
                  const state = agent.runtimeState;
                  const budgetUsedPct =
                    agent.budgetMonthlyCents > 0
                      ? Math.min(
                          100,
                          Math.round(
                            ((state?.totalCostCents ?? 0) /
                              agent.budgetMonthlyCents) *
                              100
                          )
                        )
                      : null;
                  const runs =
                    (agent as unknown as { _count?: { heartbeatRuns?: number } })
                      ._count?.heartbeatRuns ?? 0;

                  return (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/settings/agents?focus=${agent.id}`}
                          className="hover:underline"
                        >
                          {agent.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {agent.slug}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{agent.role}</TableCell>
                      <TableCell>{statusBadge(agent.status)}</TableCell>
                      <TableCell>{circuitBadge(state?.circuitState)}</TableCell>
                      <TableCell>
                        {state?.lastHeartbeatAt ? (
                          <span
                            title={new Date(
                              state.lastHeartbeatAt
                            ).toISOString()}
                          >
                            {formatRelative(state.lastHeartbeatAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                        {state?.lastError && (
                          <div className="text-xs text-red-500 truncate max-w-xs">
                            {state.lastError}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{runs}</TableCell>
                      <TableCell>
                        {budgetUsedPct !== null ? (
                          <div>
                            <div className="text-xs">
                              {formatCents(state?.totalCostCents ?? 0)} /{" "}
                              {formatCents(agent.budgetMonthlyCents)}
                            </div>
                            <div className="h-1 bg-muted rounded-full overflow-hidden mt-1 w-24">
                              <div
                                className={`h-full ${
                                  budgetUsedPct > 90
                                    ? "bg-red-500"
                                    : budgetUsedPct > 70
                                      ? "bg-amber-500"
                                      : "bg-green-500"
                                }`}
                                style={{ width: `${budgetUsedPct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            unlimited
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/settings/agents/runs?agentId=${agent.id}`}
                          className="text-xs text-primary hover:underline mr-3"
                        >
                          Runs
                        </Link>
                        <Link
                          href={`/settings/agents/heartbeat?agentId=${agent.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Heartbeat
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          Auto-refreshes on navigation. Detail pages coming in Sprint 2.
        </span>
      </div>
    </div>
  );
}
