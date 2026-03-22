"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AIRunTrace, AIRunTraceStepStatus } from "@/lib/ai/trace";
import type { AIApplySafetyLevel, AIApplyExecutionMode } from "@/lib/ai/types";

function stepVariant(status: AIRunTraceStepStatus) {
  switch (status) {
    case "done":
      return "success";
    case "running":
      return "info";
    case "failed":
      return "danger";
    case "pending":
      return "warning";
    case "not_applicable":
    default:
      return "neutral";
  }
}

function formatDateTime(value?: string) {
  if (!value) return "n/a";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safetyVariant(level: AIApplySafetyLevel) {
  switch (level) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
    default:
      return "info";
  }
}

function executionModeLabel(mode: AIApplyExecutionMode) {
  switch (mode) {
    case "preview_only":
      return "preview only";
    case "guarded_patch":
      return "guarded patch";
    case "guarded_communication":
      return "guarded communication";
  }
}

function prettyAgentId(agentId: string) {
  return agentId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function AIRunTracePanel({
  error,
  isLoading,
  onRefresh,
  trace,
}: {
  error?: string | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  trace: AIRunTrace | null;
}) {
  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
        Загружаю trace summary...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
        {error}
      </div>
    );
  }

  if (!trace) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">{trace.source.workflowLabel}</Badge>
            {trace.source.purposeLabel ? <Badge variant="neutral">{trace.source.purposeLabel}</Badge> : null}
            <Badge variant={stepVariant(trace.model.status)}>{trace.model.name}</Badge>
          </div>
          <div className="text-sm font-medium text-[var(--ink)]">{trace.source.entityLabel}</div>
          <div className="text-xs text-[var(--ink-muted)]">
            Packet: {trace.source.packetId ?? "n/a"} · Run: {trace.runId}
          </div>
        </div>

        {onRefresh ? (
          <Button onClick={onRefresh} size="sm" variant="outline">
            Refresh trace
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Facts loaded</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-[var(--ink-soft)]">
            <span>Projects: {trace.context.facts.projects}</span>
            <span>Tasks: {trace.context.facts.tasks}</span>
            <span>Risks: {trace.context.facts.risks}</span>
            <span>Team: {trace.context.facts.team}</span>
            <span>Notifications: {trace.context.facts.notifications}</span>
            <span>Context: {trace.context.title}</span>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Prompt preview</div>
          <div className="mt-2 text-sm text-[var(--ink-soft)]">{trace.promptPreview}</div>
        </div>
      </div>

      {trace.collaboration ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              Multi-agent council
            </div>
            <Badge variant="info">{trace.collaboration.mode}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="success">Leader: {prettyAgentId(trace.collaboration.leaderAgentId)}</Badge>
            {trace.collaboration.supportAgentIds.map((agentId) => (
              <Badge key={agentId} variant="neutral">
                {prettyAgentId(agentId)}
              </Badge>
            ))}
          </div>
          <div className="mt-3 text-sm text-[var(--ink-soft)]">{trace.collaboration.reason}</div>
          <div className="mt-4 grid gap-2">
            {trace.collaboration.steps.map((step) => (
              <div
                key={`${step.agentId}-${step.runtime.provider}-${step.runtime.model}`}
                className="grid gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-[var(--ink)]">
                    {prettyAgentId(step.agentId)}
                  </div>
                  <Badge variant={stepVariant(step.status)}>{step.status}</Badge>
                </div>
                <div className="text-sm text-[var(--ink-soft)]">{step.summary}</div>
                <div className="text-xs text-[var(--ink-muted)]">
                  {step.runtime.provider} · {step.runtime.model}
                </div>
              </div>
            ))}
          </div>
          {trace.collaboration.consensus.length > 0 ? (
            <div className="mt-4 rounded-[12px] border border-[var(--line)] bg-[color:var(--surface-panel-strong)] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Council consensus
              </div>
              <div className="mt-2 grid gap-2">
                {trace.collaboration.consensus.map((item) => (
                  <div key={item} className="rounded-[10px] bg-[var(--panel-soft)] px-3 py-2 text-sm text-[var(--ink-soft)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        {trace.steps.map((step) => (
          <div
            key={step.id}
            className="grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-[var(--ink)]">{step.label}</div>
              <Badge variant={stepVariant(step.status)}>{step.status}</Badge>
            </div>
            <div className="text-sm text-[var(--ink-soft)]">{step.summary}</div>
            <div className="text-xs text-[var(--ink-muted)]">
              {formatDateTime(step.startedAt)} → {formatDateTime(step.endedAt)}
            </div>
          </div>
        ))}
      </div>

      {trace.proposal.type ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">{trace.proposal.type}</Badge>
            {trace.proposal.state ? <Badge variant="neutral">{trace.proposal.state}</Badge> : null}
            {trace.proposal.safety ? (
              <>
                <Badge variant={safetyVariant(trace.proposal.safety.level)}>
                  {trace.proposal.safety.level} safety
                </Badge>
                <Badge variant="neutral">
                  {executionModeLabel(trace.proposal.safety.executionMode)}
                </Badge>
              </>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--ink)]">{trace.proposal.title}</div>
          <div className="mt-1 text-sm text-[var(--ink-soft)]">{trace.proposal.summary}</div>
          <div className="mt-2 text-xs text-[var(--ink-muted)]">
            Items: {trace.proposal.itemCount}
            {trace.proposal.previewItems.length > 0
              ? ` · ${trace.proposal.previewItems.join(" · ")}`
              : ""}
          </div>
          {trace.proposal.safety ? (
            <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)]">
              <div>Surface: {trace.proposal.safety.mutationSurface}</div>
              <div>Compensation: {trace.proposal.safety.compensationSummary}</div>
              <div>Checks: {trace.proposal.safety.checks.join(" · ")}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {trace.apply ? (
        <div className="rounded-[14px] border border-emerald-300/40 bg-emerald-500/10 p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-emerald-200/90">Apply result</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={safetyVariant(trace.apply.safety.level)}>
              {trace.apply.safety.level} safety
            </Badge>
            <Badge variant="neutral">
              {executionModeLabel(trace.apply.safety.executionMode)}
            </Badge>
            <Badge variant="neutral">{trace.apply.safety.postApplyState}</Badge>
          </div>
          <div className="mt-2 text-sm text-[var(--ink)]">{trace.apply.summary}</div>
          <div className="mt-1 text-xs text-[var(--ink-muted)]">
            Applied: {formatDateTime(trace.apply.appliedAt)} · Items: {trace.apply.itemCount}
          </div>
          <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)]">
            <div>Compensation: {trace.apply.safety.compensationSummary}</div>
            <div>Steps: {trace.apply.safety.compensationSteps.join(" · ")}</div>
          </div>
        </div>
      ) : null}

      {trace.failure ? (
        <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {trace.failure.message}
        </div>
      ) : null}
    </div>
  );
}
