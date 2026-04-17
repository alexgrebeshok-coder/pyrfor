"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  GitBranch,
  PlayCircle,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkflowStep = {
  id: string;
  nodeId: string;
  name: string;
  stepType: string;
  seq: number;
  status: string;
  dependsOn: string[];
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  errorMessage: string | null;
  approvalId: string | null;
  checkpointId: string | null;
  heartbeatRunId: string | null;
  attemptCount: number;
  maxRetries: number;
  startedAt: string | null;
  finishedAt: string | null;
  agent: { id: string; name: string; role: string; slug: string } | null;
  heartbeatRun:
    | {
        id: string;
        status: string;
        createdAt: string;
        startedAt: string | null;
        finishedAt: string | null;
      }
    | null;
  approval:
    | {
        id: string;
        title: string;
        status: string;
        comment: string | null;
        createdAt: string;
        reviewedAt: string | null;
      }
    | null;
};

type WorkflowRunDetail = {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  inputJson: Record<string, unknown>;
  contextJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  template: {
    id: string;
    name: string;
    version: number;
    status: string;
    definitionJson: {
      outputNodes?: string[];
      nodes: Array<{
        id: string;
        name: string;
        kind: string;
      }>;
    };
  };
  summary: Record<string, number>;
  steps: WorkflowStep[];
  delegations: Array<{
    id: string;
    workflowStepId: string | null;
    reason: string;
    status: string;
    metadataJson: Record<string, unknown>;
    createdAt: string;
    resolvedAt: string | null;
    parentAgent: { id: string; name: string; role: string } | null;
    childAgent: { id: string; name: string; role: string };
    parentRun: { id: string; status: string; createdAt: string } | null;
    childRun: { id: string; status: string; createdAt: string } | null;
  }>;
};

const STATUS_VARIANTS: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  queued: "neutral",
  running: "info",
  waiting_approval: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  skipped: "neutral",
  active: "success",
  draft: "warning",
};

function stringifyPreview(value: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) {
    return "—";
  }

  if (typeof value.content === "string") {
    return value.content;
  }
  if (typeof value.comment === "string") {
    return value.comment;
  }

  return JSON.stringify(value, null, 2);
}

export default function WorkflowRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const router = useRouter();
  const [runId, setRunId] = useState("");
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    params.then((resolved) => setRunId(resolved.runId));
  }, [params]);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/orchestration/workflow-runs/${runId}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load workflow run");
        return;
      }
      setRun(data.run ?? null);
    } catch {
      toast.error("Failed to load workflow run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    fetchRun();
  }, [fetchRun, runId]);

  useEffect(() => {
    if (!run || !["queued", "running", "waiting_approval"].includes(run.status)) {
      return;
    }

    const interval = setInterval(() => {
      fetchRun();
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchRun, run]);

  const advanceRun = async () => {
    if (!runId) {
      return;
    }

    setAdvancing(true);
    try {
      const res = await fetch(`/api/orchestration/workflow-runs/${runId}/advance`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to reconcile workflow run");
        return;
      }
      setRun(data.run ?? null);
      toast.success("Workflow run reconciled");
    } catch {
      toast.error("Failed to reconcile workflow run");
    } finally {
      setAdvancing(false);
    }
  };

  const orderedSteps = useMemo(
    () => [...(run?.steps ?? [])].sort((left, right) => left.seq - right.seq),
    [run?.steps]
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
          Loading workflow run…
        </CardContent>
      </Card>
    );
  }

  if (!run) {
    return (
      <Card>
        <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
          Workflow run not found
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-4 p-6">
          <Link
            href="/settings/agents/workflows"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            <ArrowLeft size={16} /> Workflows
          </Link>
          <div className="flex-1" />
          <Badge variant={STATUS_VARIANTS[run.status] ?? "neutral"} className="text-xs">
            {run.status}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow size={16} /> {run.template.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
            <InfoItem label="Trigger" value={run.triggerType} />
            <InfoItem label="Template version" value={`v${run.template.version}`} />
            <InfoItem
              label="Started"
              value={run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
            />
            <InfoItem
              label="Finished"
              value={run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}
            />
            <InfoItem label="Queued steps" value={String(run.summary.queued ?? 0)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={advanceRun} disabled={advancing}>
              <RefreshCw size={14} className={`mr-1 ${advancing ? "animate-spin" : ""}`} />
              {advancing ? "Reconciling…" : "Reconcile run"}
            </Button>
            <Link href="/approvals">
              <Button variant="outline">
                <PlayCircle size={14} className="mr-1" /> Open approvals
              </Button>
            </Link>
          </div>

          {run.errorMessage ? (
            <div className="rounded border p-3 text-sm" style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}>
              {run.errorMessage}
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
              <p className="mb-2 text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
                Workflow input
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs" style={{ color: "var(--ink-soft)" }}>
                {JSON.stringify(run.inputJson, null, 2)}
              </pre>
            </div>
            <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
              <p className="mb-2 text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
                Workflow result
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs" style={{ color: "var(--ink-soft)" }}>
                {Object.keys(run.resultJson).length > 0 ? JSON.stringify(run.resultJson, null, 2) : "—"}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step graph</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {orderedSteps.map((step) => (
            <div
              key={step.id}
              className="rounded border p-4"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral" className="text-xs">
                  #{step.seq + 1}
                </Badge>
                <Badge variant={STATUS_VARIANTS[step.status] ?? "neutral"} className="text-xs">
                  {step.status}
                </Badge>
                <span className="font-medium" style={{ color: "var(--ink)" }}>
                  {step.name}
                </span>
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  {step.stepType}
                </span>
                <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                  attempt {step.attemptCount}/{step.maxRetries}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4" style={{ color: "var(--ink-soft)" }}>
                <span>Node: {step.nodeId}</span>
                <span>Depends on: {step.dependsOn.length > 0 ? step.dependsOn.join(", ") : "root"}</span>
                <span>Started: {step.startedAt ? new Date(step.startedAt).toLocaleString() : "—"}</span>
                <span>Finished: {step.finishedAt ? new Date(step.finishedAt).toLocaleString() : "—"}</span>
              </div>

              {step.agent ? (
                <div className="mt-3">
                  <Badge variant="info" className="text-xs">
                    {step.agent.name} · {step.agent.role}
                  </Badge>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
                  <p className="mb-2 text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
                    Step input
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs" style={{ color: "var(--ink-soft)" }}>
                    {Object.keys(step.inputJson).length > 0
                      ? JSON.stringify(step.inputJson, null, 2)
                      : "—"}
                  </pre>
                </div>
                <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
                  <p className="mb-2 text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
                    Step output
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs" style={{ color: "var(--ink-soft)" }}>
                    {stringifyPreview(step.outputJson)}
                  </pre>
                </div>
              </div>

              {step.errorMessage ? (
                <p className="mt-3 text-sm" style={{ color: "var(--ink-soft)" }}>
                  {step.errorMessage}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {step.heartbeatRunId ? (
                  <Link href={`/settings/agents/runs/${step.heartbeatRunId}`}>
                    <Badge variant="info" className="cursor-pointer text-xs">
                      Open heartbeat run
                    </Badge>
                  </Link>
                ) : null}
                {step.approval ? (
                  <Link href="/approvals">
                    <Badge variant="warning" className="cursor-pointer text-xs">
                      Approval: {step.approval.status}
                    </Badge>
                  </Link>
                ) : null}
                {step.checkpointId ? (
                  <Badge variant="neutral" className="text-xs">
                    checkpoint {step.checkpointId.slice(0, 8)}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch size={16} /> Delegation lineage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {run.delegations.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No delegation edges recorded for this workflow run.
            </p>
          ) : (
            <div className="grid gap-3">
              {run.delegations.map((delegation) => (
                <div
                  key={delegation.id}
                  className="rounded border p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[delegation.status] ?? "neutral"} className="text-xs">
                      {delegation.status}
                    </Badge>
                    <span className="font-medium" style={{ color: "var(--ink)" }}>
                      {delegation.parentAgent?.name ?? "Workflow root"} → {delegation.childAgent.name}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                      {new Date(delegation.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                    {delegation.reason}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {delegation.parentRun ? (
                      <Link href={`/settings/agents/runs/${delegation.parentRun.id}`}>
                        <Badge variant="neutral" className="cursor-pointer text-xs">
                          Parent run
                        </Badge>
                      </Link>
                    ) : null}
                    {delegation.childRun ? (
                      <Link href={`/settings/agents/runs/${delegation.childRun.id}`}>
                        <Badge variant="info" className="cursor-pointer text-xs">
                          Child run
                        </Badge>
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => router.refresh()}>
          Refresh page
        </Button>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        {label}
      </span>
      <p style={{ color: "var(--ink)" }}>{value}</p>
    </div>
  );
}
