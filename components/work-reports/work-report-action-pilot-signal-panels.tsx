"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AIRunTracePanel } from "@/components/ai/ai-run-trace-panel";
import type { AIRunTrace } from "@/lib/ai/trace";
import { getProposalItemCount, getProposalSafetyProfile } from "@/lib/ai/action-engine";
import type { WorkReportSignalPacket } from "@/lib/work-reports/types";
import {
  executionModeLabel,
  safetyVariant,
  severityVariant,
} from "@/components/work-reports/work-report-action-pilot-utils";

export function WorkReportActionPilotPacketAlerts({
  packet,
}: {
  packet: WorkReportSignalPacket;
}) {
  if (packet.signal.topAlerts.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {packet.signal.topAlerts.map((alert) => (
        <div
          key={alert.id}
          className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
            <span className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              {alert.category}
            </span>
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--ink)]">{alert.title}</div>
          <div className="mt-1 text-sm text-[var(--ink-soft)]">{alert.summary}</div>
        </div>
      ))}
    </div>
  );
}

export function WorkReportActionPilotPacketRuns({
  applyingRunIds,
  loadingTraceIds,
  onApplyProposal,
  onToggleTrace,
  selectedTraceRunId,
  loadTrace,
  packet,
  traceErrors,
  traces,
}: {
  applyingRunIds: string[];
  loadTrace: (runId: string) => Promise<void>;
  onApplyProposal: (runId: string, proposalId: string) => void;
  onToggleTrace: (runId: string) => void;
  packet: WorkReportSignalPacket;
  selectedTraceRunId: string | null;
  loadingTraceIds: string[];
  traceErrors: Record<string, string | null>;
  traces: Record<string, AIRunTrace>;
}) {
  return (
    <div className="grid gap-3">
      {packet.runs.map((entry) => {
        const proposal = entry.run.result?.proposal ?? null;
        const isApplying = applyingRunIds.includes(entry.run.id);
        const canApply = proposal?.state === "pending";
        const safety = proposal ? getProposalSafetyProfile(proposal) : null;

        return (
          <div
            key={entry.run.id}
            className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">{entry.label}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {entry.purpose} · {entry.run.status}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {proposal ? (
                  <Badge variant={proposal.state === "applied" ? "success" : "warning"}>
                    {proposal.type}
                  </Badge>
                ) : null}
                {safety ? (
                  <>
                    <Badge variant={safetyVariant(safety.level)}>{safety.level} safety</Badge>
                    <Badge variant="neutral">{executionModeLabel(safety.executionMode)}</Badge>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mt-3 text-sm text-[var(--ink-soft)]">
              {entry.run.result?.summary ?? "AI run ещё не вернул summary."}
            </div>

            <div className="mt-3 flex flex-wrap gap-3">
              <Button onClick={() => onToggleTrace(entry.run.id)} size="sm" variant="outline">
                {selectedTraceRunId === entry.run.id ? "Hide trace" : "Open trace"}
              </Button>
              {canApply && proposal ? (
                <Button
                  disabled={isApplying}
                  onClick={() => onApplyProposal(entry.run.id, proposal.id)}
                  size="sm"
                >
                  {isApplying ? "Применение..." : "Apply proposal"}
                </Button>
              ) : null}
            </div>

            {proposal ? (
              <div className="mt-3 grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
                <div className="text-sm font-medium text-[var(--ink)]">{proposal.title}</div>
                <div className="text-sm text-[var(--ink-soft)]">{proposal.summary}</div>
                <div className="text-xs text-[var(--ink-muted)]">
                  Item count: {getProposalItemCount(proposal)}
                </div>
                {safety ? (
                  <div className="grid gap-2 text-xs text-[var(--ink-soft)]">
                    <div>Surface: {safety.mutationSurface}</div>
                    <div>Compensation: {safety.compensationSummary}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedTraceRunId === entry.run.id ? (
              <AIRunTracePanel
                error={traceErrors[entry.run.id]}
                isLoading={loadingTraceIds.includes(entry.run.id)}
                onRefresh={() => void loadTrace(entry.run.id)}
                trace={traces[entry.run.id] ?? null}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
