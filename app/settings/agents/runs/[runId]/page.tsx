"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, Clock, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──

type RunEvent = {
  type: string;
  content: string;
  createdAt: string;
};

type RunCheckpoint = {
  id: string;
  seq: number;
  stepKey: string;
  checkpointType: string;
  stateJson: string;
  createdAt: string;
};

type ReplayRunSummary = {
  id: string;
  status: string;
  createdAt: string;
  replayReason: string | null;
};

type DeadLetterEntry = {
  id: string;
  status: string;
  errorType: string;
  errorMessage: string;
  createdAt: string;
};

type WorkflowStepLink = {
  id: string;
  nodeId: string;
  name: string;
  status: string;
  workflowRunId: string;
  workflowRun: {
    id: string;
    status: string;
    template: {
      name: string;
      version: number;
    };
  };
};

type DelegationEdge = {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  childAgent?: { id: string; name: string; role: string } | null;
  childRun?: { id: string; status: string; createdAt: string } | null;
  parentAgent?: { id: string; name: string; role: string } | null;
  parentRun?: { id: string; status: string; createdAt: string } | null;
};

type RunDetail = {
  id: string;
  status: string;
  invocationSource: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  usageJson: string | null;
  resultJson: string | null;
  contextSnapshot: string | null;
  replayReason: string | null;
  replayedFromCheckpointId: string | null;
  agent: { name: string; slug: string; role: string };
  events: RunEvent[];
  checkpoints: RunCheckpoint[];
  replayOfRun: { id: string; status: string; createdAt: string } | null;
  replayRuns: ReplayRunSummary[];
  deadLetterJobs: DeadLetterEntry[];
  workflowStep: WorkflowStepLink | null;
  outgoingDelegations: DelegationEdge[];
  incomingDelegations: DelegationEdge[];
};

const STATUS_BADGE: Record<string, { variant: "success" | "danger" | "warning" | "info" | "neutral"; icon: typeof CheckCircle }> = {
  queued: { variant: "neutral", icon: Clock },
  running: { variant: "info", icon: Zap },
  succeeded: { variant: "success", icon: CheckCircle },
  failed: { variant: "danger", icon: XCircle },
  cancelled: { variant: "warning", icon: XCircle },
  timed_out: { variant: "danger", icon: Clock },
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Page ──

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [runId, setRunId] = useState<string>("");
  const [replayingCheckpointId, setReplayingCheckpointId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    params.then((p) => setRunId(p.runId));
  }, [params]);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/orchestration/runs/${runId}`);
      const data = await res.json();
      setRun(data.run ?? null);
    } catch {
      toast.error("Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    fetchRun();
    // Live tail: poll if running
    const interval = setInterval(() => {
      if (run?.status === "running" || run?.status === "queued") {
        fetchRun();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [runId, fetchRun, run?.status]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
          Loading run…
        </CardContent>
      </Card>
    );
  }

  if (!run) {
    return (
      <Card>
        <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
          Run not found
        </CardContent>
      </Card>
    );
  }

  const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.queued;
  const BadgeIcon = badge.icon;
  const usage = run.usageJson ? JSON.parse(run.usageJson) : null;
  const result = run.resultJson ? JSON.parse(run.resultJson) : null;
  const replayRun = async (checkpointId?: string) => {
    if (!runId) return;
    setReplayingCheckpointId(checkpointId ?? "root");
    try {
      const res = await fetch(`/api/orchestration/runs/${runId}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkpointId ? { checkpointId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to queue replay");
        return;
      }
      toast.success("Replay queued");
      router.push(`/settings/agents/runs/${data.replayRunId}`);
    } catch {
      toast.error("Failed to queue replay");
    } finally {
      setReplayingCheckpointId(null);
    }
  };

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
          <Badge variant={badge.variant} className="flex items-center gap-1">
            <BadgeIcon size={12} />
            {run.status}
          </Badge>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Run {run.id.slice(0, 12)}… — {run.agent.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>Agent</span>
              <p style={{ color: "var(--ink)" }}>{run.agent.name} ({run.agent.role})</p>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>Source</span>
              <p style={{ color: "var(--ink)" }}>{run.invocationSource}</p>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>Duration</span>
              <p style={{ color: "var(--ink)" }}>{formatDuration(run.startedAt, run.finishedAt)}</p>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>Started</span>
              <p style={{ color: "var(--ink)" }}>
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void replayRun()}
              disabled={replayingCheckpointId !== null}
            >
              {replayingCheckpointId === "root" ? "Queueing replay…" : "Replay from start"}
            </Button>
            {run.replayOfRun ? (
              <Link href={`/settings/agents/runs/${run.replayOfRun.id}`}>
                <Badge variant="warning" className="cursor-pointer">
                  Replay of {run.replayOfRun.id.slice(0, 12)}…
                </Badge>
              </Link>
            ) : null}
            {run.replayReason ? (
              <Badge variant="info">{run.replayReason}</Badge>
            ) : null}
            {run.workflowStep ? (
              <Link href={`/settings/agents/workflows/runs/${run.workflowStep.workflowRunId}`}>
                <Badge variant="warning" className="cursor-pointer">
                  Workflow {run.workflowStep.workflowRun.template.name} · {run.workflowStep.name}
                </Badge>
              </Link>
            ) : null}
          </div>

          {/* Usage */}
          {usage && (
            <div className="mt-4 rounded border p-3" style={{ borderColor: "var(--line)", background: "var(--panel-soft)" }}>
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
                Usage
              </span>
              <div className="flex flex-wrap gap-4 text-sm" style={{ color: "var(--ink)" }}>
                <span>{usage.tokens ?? 0} tokens</span>
                <span>${(usage.costUsd ?? 0).toFixed(4)}</span>
                <span>{usage.model}</span>
                <span>{usage.provider}</span>
                {usage.durationMs && <span>{(usage.durationMs / 1000).toFixed(1)}s</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checkpoints ({run.checkpoints.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {run.checkpoints.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No checkpoints recorded for this run.
            </p>
          ) : (
            <div className="grid gap-2">
              {run.checkpoints.map((checkpoint) => (
                <div
                  key={checkpoint.id}
                  className="flex flex-wrap items-center gap-3 rounded border px-3 py-2"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Badge variant="neutral" className="text-xs">
                    {checkpoint.checkpointType}
                  </Badge>
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {checkpoint.stepKey}
                  </span>
                  <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    #{checkpoint.seq}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                    {new Date(checkpoint.createdAt).toLocaleTimeString()}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void replayRun(checkpoint.id)}
                    disabled={replayingCheckpointId !== null}
                  >
                    {replayingCheckpointId === checkpoint.id ? "Queueing…" : "Replay from here"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(run.workflowStep ||
        run.replayRuns.length > 0 ||
        run.deadLetterJobs.length > 0 ||
        run.outgoingDelegations.length > 0 ||
        run.incomingDelegations.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lineage & recovery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {run.workflowStep ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Workflow linkage
                </p>
                <Link
                  href={`/settings/agents/workflows/runs/${run.workflowStep.workflowRunId}`}
                  className="flex items-center gap-3 rounded border px-3 py-2"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Badge variant="warning" className="text-xs">
                    {run.workflowStep.status}
                  </Badge>
                  <span className="text-sm" style={{ color: "var(--ink)" }}>
                    {run.workflowStep.workflowRun.template.name} · {run.workflowStep.name}
                  </span>
                  <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    node {run.workflowStep.nodeId} · v{run.workflowStep.workflowRun.template.version}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                    workflow {run.workflowStep.workflowRun.status}
                  </span>
                </Link>
              </div>
            ) : null}

            {run.replayRuns.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Replay runs
                </p>
                {run.replayRuns.map((replay) => (
                  <Link
                    key={replay.id}
                    href={`/settings/agents/runs/${replay.id}`}
                    className="flex items-center gap-3 rounded border px-3 py-2"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <Badge
                      variant={replay.status === "succeeded" ? "success" : replay.status === "failed" ? "danger" : "neutral"}
                      className="text-xs"
                    >
                      {replay.status}
                    </Badge>
                    <span className="text-sm" style={{ color: "var(--ink)" }}>
                      {replay.id.slice(0, 12)}…
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {replay.replayReason ?? "manual_replay"}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                      {new Date(replay.createdAt).toLocaleString()}
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}

            {run.outgoingDelegations.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Delegated to child runs
                </p>
                {run.outgoingDelegations.map((delegation) => (
                  <div
                    key={delegation.id}
                    className="rounded border px-3 py-2"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info" className="text-xs">
                        {delegation.status}
                      </Badge>
                      <span className="text-sm" style={{ color: "var(--ink)" }}>
                        {delegation.childAgent?.name ?? "Unknown child agent"}
                      </span>
                      {delegation.childRun ? (
                        <Link href={`/settings/agents/runs/${delegation.childRun.id}`}>
                          <Badge variant="neutral" className="cursor-pointer text-xs">
                            child run
                          </Badge>
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                      {delegation.reason}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {run.incomingDelegations.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Delegated from parent runs
                </p>
                {run.incomingDelegations.map((delegation) => (
                  <div
                    key={delegation.id}
                    className="rounded border px-3 py-2"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning" className="text-xs">
                        {delegation.status}
                      </Badge>
                      <span className="text-sm" style={{ color: "var(--ink)" }}>
                        {delegation.parentAgent?.name ?? "Workflow root"}
                      </span>
                      {delegation.parentRun ? (
                        <Link href={`/settings/agents/runs/${delegation.parentRun.id}`}>
                          <Badge variant="neutral" className="cursor-pointer text-xs">
                            parent run
                          </Badge>
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                      {delegation.reason}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {run.deadLetterJobs.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Dead-letter incidents
                </p>
                {run.deadLetterJobs.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border px-3 py-2"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="danger" className="text-xs">
                        {item.errorType}
                      </Badge>
                      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm" style={{ color: "var(--ink)" }}>
                      {item.errorMessage}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Events Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events ({run.events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {run.events.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No events recorded
            </p>
          ) : (
            <div className="grid gap-2">
              {run.events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded border px-3 py-2"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Badge
                    variant={
                      ev.type === "error"
                        ? "danger"
                        : ev.type === "completed"
                          ? "success"
                          : "neutral"
                    }
                    className="mt-0.5 shrink-0 text-xs"
                  >
                    {ev.type}
                  </Badge>
                  <p className="flex-1 text-sm" style={{ color: "var(--ink)" }}>
                    {ev.content}
                  </p>
                  <span className="shrink-0 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {new Date(ev.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {result?.content && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              className="max-h-96 overflow-auto whitespace-pre-wrap rounded p-3 text-sm"
              style={{
                background: "var(--panel-soft)",
                color: "var(--ink)",
                border: "1px solid var(--line)",
              }}
            >
              {result.content}
            </pre>
          </CardContent>
        </Card>
      )}

      {result?.error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base" style={{ color: "var(--danger)" }}>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              className="overflow-auto whitespace-pre-wrap rounded p-3 text-sm"
              style={{ background: "rgba(239,68,68,0.1)", color: "var(--ink)" }}
            >
              {result.error}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
