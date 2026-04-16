"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──

type RunEvent = {
  type: string;
  content: string;
  createdAt: string;
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
  agent: { name: string; slug: string; role: string };
  events: RunEvent[];
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
