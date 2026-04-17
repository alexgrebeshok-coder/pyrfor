"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  GitBranch,
  ListChecks,
  ShieldAlert,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

type OpsSnapshot = {
  summary: {
    activeAgentRuns: number;
    openDeadLetters: number;
    openCircuits: number;
    pendingWorkflowApprovals: number;
    activeWorkflowRuns: number;
    failedWorkflowRuns: number;
    succeededWorkflowRuns: number;
  };
  recentWorkflowRuns: Array<{
    id: string;
    status: string;
    triggerType: string;
    createdAt: string;
    errorMessage: string | null;
    template: { id: string; name: string; version: number };
    summary: Record<string, number>;
  }>;
  workflowApprovals: Array<{
    id: string;
    title: string;
    entityId: string | null;
    createdAt: string;
    metadata: { canonicalPath?: string; workflowNodeName?: string };
  }>;
  circuitAgents: Array<{
    id: string;
    name: string;
    role: string;
    runtimeState: {
      circuitState: string;
      circuitOpenUntil: string | null;
      consecutiveFailures: number;
      lastError: string | null;
    } | null;
  }>;
  deadLetters: Array<{
    id: string;
    reason: string;
    errorType: string;
    errorMessage: string;
    createdAt: string;
    runId: string | null;
    agent: { id: string; name: string; role: string };
  }>;
};

type OrchestrationDocs = {
  scenarios: Array<{
    id: string;
    title: string;
    description: string;
    steps: string[];
  }>;
  roadmap: Array<{
    phase: string;
    status: string;
    outcome: string;
  }>;
  definitionOfDone: string[];
  finalExpectedResult: {
    product: string;
    operator: string;
    system: string;
  };
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_BADGE: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  succeeded: "success",
  failed: "danger",
  running: "info",
  queued: "neutral",
  waiting_approval: "warning",
  active: "success",
  draft: "warning",
  next: "neutral",
  implemented: "success",
};

export default function AgentDashboardPage() {
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [ops, setOps] = useState<OpsSnapshot | null>(null);
  const [docs, setDocs] = useState<OrchestrationDocs | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, activityRes, opsRes, docsRes] = await Promise.all([
        fetch("/api/orchestration/agents"),
        fetch("/api/orchestration/activity?limit=15"),
        fetch("/api/orchestration/ops"),
        fetch("/api/orchestration/docs"),
      ]);
      const [agentsData, activityData, opsData, docsData] = await Promise.all([
        agentsRes.json(),
        activityRes.json(),
        opsRes.json(),
        docsRes.json(),
      ]);
      setAgents(agentsData.agents ?? []);
      setActivity(activityData.items ?? []);
      setOps(opsData);
      setDocs(docsData);
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalAgents = agents.length;
  const activeAgents = agents.filter((agent) => agent.status === "running").length;
  const totalRuns = agents.reduce((sum, agent) => sum + (agent.runtimeState?.totalRuns ?? 0), 0);
  const successfulRuns = agents.reduce(
    (sum, agent) => sum + (agent.runtimeState?.successfulRuns ?? 0),
    0
  );
  const totalTokens = agents.reduce((sum, agent) => sum + (agent.runtimeState?.totalTokens ?? 0), 0);
  const totalCostCents = agents.reduce(
    (sum, agent) => sum + (agent.runtimeState?.totalCostCents ?? 0),
    0
  );
  const totalBudgetCents = agents.reduce((sum, agent) => sum + agent.budgetMonthlyCents, 0);
  const totalSpentCents = agents.reduce((sum, agent) => sum + agent.spentMonthlyCents, 0);
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

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/settings/agents/heartbeat">
          <Badge variant="info" className="cursor-pointer">
            Open heartbeat monitor
          </Badge>
        </Link>
        <Link href="/settings/agents/workflows">
          <Badge variant="warning" className="cursor-pointer">
            Open workflow builder
          </Badge>
        </Link>
        <Link href="/approvals">
          <Badge variant="neutral" className="cursor-pointer">
            Open approvals
          </Badge>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Agents" value={String(totalAgents)} sub={`${activeAgents} active`} />
        <StatCard label="Total Runs" value={String(totalRuns)} sub={`${successRate}% success`} />
        <StatCard label="Tokens Used" value={totalTokens.toLocaleString()} sub={`${formatCents(totalCostCents)} total cost`} />
        <StatCard
          label="Monthly Budget"
          value={formatCents(totalSpentCents)}
          sub={totalBudgetCents > 0 ? `of ${formatCents(totalBudgetCents)} budget` : "no budget set"}
        />
      </div>

      {ops ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Workflow Runs"
            value={String(ops.summary.activeWorkflowRuns)}
            sub={`${ops.summary.succeededWorkflowRuns} succeeded · ${ops.summary.failedWorkflowRuns} failed`}
            icon={<Workflow size={16} />}
          />
          <StatCard
            label="Approval Gates"
            value={String(ops.summary.pendingWorkflowApprovals)}
            sub="Waiting on human override"
            icon={<ListChecks size={16} />}
          />
          <StatCard
            label="Open Circuits"
            value={String(ops.summary.openCircuits)}
            sub="Agents temporarily protected"
            icon={<ShieldAlert size={16} />}
          />
          <StatCard
            label="Dead Letters"
            value={String(ops.summary.openDeadLetters)}
            sub="Terminal failures awaiting action"
            icon={<GitBranch size={16} />}
          />
        </div>
      ) : null}

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
                    (left, right) =>
                      (right.runtimeState?.totalRuns ?? 0) -
                      (left.runtimeState?.totalRuns ?? 0)
                  )
                  .map((agent) => {
                    const runtimeState = agent.runtimeState;
                    const rate =
                      runtimeState && runtimeState.totalRuns > 0
                        ? `${((runtimeState.successfulRuns / runtimeState.totalRuns) * 100).toFixed(0)}%`
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
                        <td className="px-2 py-2 text-right">{runtimeState?.totalRuns ?? 0}</td>
                        <td className="px-2 py-2 text-right">{rate}</td>
                        <td className="px-2 py-2 text-right">
                          {(runtimeState?.totalTokens ?? 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatCents(runtimeState?.totalCostCents ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--ink-muted)" }}>
                          {runtimeState?.lastHeartbeatAt
                            ? new Date(runtimeState.lastHeartbeatAt).toLocaleDateString()
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

      {ops ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Workflow size={16} /> Workflow Control Plane
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ops.recentWorkflowRuns.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  No workflow runs yet.
                </p>
              ) : (
                <div className="grid gap-3">
                  {ops.recentWorkflowRuns.map((run) => (
                    <Link
                      key={run.id}
                      href={`/settings/agents/workflows/runs/${run.id}`}
                      className="rounded border p-3 transition-colors hover:bg-[var(--panel-soft)]"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_BADGE[run.status] ?? "neutral"} className="text-xs">
                          {run.status}
                        </Badge>
                        <span className="font-medium" style={{ color: "var(--ink)" }}>
                          {run.template.name}
                        </span>
                        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {run.triggerType} · v{run.template.version}
                        </span>
                        <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                        <span>Running {run.summary.running ?? 0}</span>
                        <span>Waiting approval {run.summary.waiting_approval ?? 0}</span>
                        <span>Succeeded {run.summary.succeeded ?? 0}</span>
                        <span>Failed {run.summary.failed ?? 0}</span>
                      </div>
                      {run.errorMessage ? (
                        <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                          {run.errorMessage}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Approval gates</CardTitle>
              </CardHeader>
              <CardContent>
                {ops.workflowApprovals.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    No pending workflow approvals.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {ops.workflowApprovals.map((approval) => (
                      <Link
                        key={approval.id}
                        href={approval.metadata.canonicalPath ?? "/approvals"}
                        className="rounded border p-3 transition-colors hover:bg-[var(--panel-soft)]"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <p className="font-medium" style={{ color: "var(--ink)" }}>
                          {approval.title}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                          {new Date(approval.createdAt).toLocaleString()}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Circuit protection</CardTitle>
              </CardHeader>
              <CardContent>
                {ops.circuitAgents.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    No agents in open or half-open state.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {ops.circuitAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="rounded border p-3"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="warning" className="text-xs">
                            {agent.runtimeState?.circuitState ?? "open"}
                          </Badge>
                          <span className="font-medium" style={{ color: "var(--ink)" }}>
                            {agent.name}
                          </span>
                        </div>
                        <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                          Failures: {agent.runtimeState?.consecutiveFailures ?? 0}
                        </p>
                        {agent.runtimeState?.lastError ? (
                          <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                            {agent.runtimeState.lastError}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dead-letter queue</CardTitle>
              </CardHeader>
              <CardContent>
                {ops.deadLetters.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    No dead-letter incidents.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {ops.deadLetters.map((item) => (
                      <Link
                        key={item.id}
                        href={item.runId ? `/settings/agents/runs/${item.runId}` : "/settings/agents/heartbeat"}
                        className="rounded border p-3 transition-colors hover:bg-[var(--panel-soft)]"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="danger" className="text-xs">
                            {item.errorType}
                          </Badge>
                          <span className="font-medium" style={{ color: "var(--ink)" }}>
                            {item.agent.name}
                          </span>
                        </div>
                        <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                          {item.errorMessage}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {docs ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch size={16} /> Orchestration scenarios
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {docs.scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className="rounded border p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <p className="font-medium" style={{ color: "var(--ink)" }}>
                    {scenario.title}
                  </p>
                  <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                    {scenario.description}
                  </p>
                  <ol className="mt-3 grid gap-1 text-sm" style={{ color: "var(--ink-soft)" }}>
                    {scenario.steps.map((step, index) => (
                      <li key={`${scenario.id}-${index}`}>{index + 1}. {step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Roadmap</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {docs.roadmap.map((item) => (
                  <div
                    key={item.phase}
                    className="rounded border p-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_BADGE[item.status] ?? "neutral"} className="text-xs">
                        {item.status}
                      </Badge>
                      <span className="font-medium" style={{ color: "var(--ink)" }}>
                        {item.phase}
                      </span>
                    </div>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                      {item.outcome}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks size={16} /> Definition of Done
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                {docs.definitionOfDone.map((item, index) => (
                  <p key={`${item}-${index}`}>{index + 1}. {item}</p>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Final expected result</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm" style={{ color: "var(--ink-soft)" }}>
                <div>
                  <p className="font-medium" style={{ color: "var(--ink)" }}>Product</p>
                  <p>{docs.finalExpectedResult.product}</p>
                </div>
                <div>
                  <p className="font-medium" style={{ color: "var(--ink)" }}>Operator</p>
                  <p>{docs.finalExpectedResult.operator}</p>
                </div>
                <div>
                  <p className="font-medium" style={{ color: "var(--ink)" }}>System</p>
                  <p>{docs.finalExpectedResult.system}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

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
                  {item.usageJson?.tokens ? (
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {item.usageJson.tokens} tok
                    </span>
                  ) : null}
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

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {icon ? <span style={{ color: "var(--ink-muted)" }}>{icon}</span> : null}
          <p className="text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
            {label}
          </p>
        </div>
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
