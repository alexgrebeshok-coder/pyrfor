"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AIRunTraceComparison } from "@/lib/ai/trace-comparison";

function diffVariant(isSame: boolean) {
  return isSame ? "success" : "warning";
}

function deltaLabel(delta: number) {
  if (delta === 0) {
    return "0";
  }

  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function AIRunComparisonCard({
  comparison,
}: {
  comparison: AIRunTraceComparison;
}) {
  return (
    <Card className="border-[color:var(--brand)]/15 bg-[color:var(--surface-panel)]/96">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Replay comparison</CardTitle>
            <p className="text-sm leading-6 text-[var(--ink-soft)]">{comparison.summary}</p>
          </div>
          <Badge variant={comparison.changedFields.length === 0 ? "success" : "warning"}>
            {comparison.changedFields.length === 0 ? "Matched" : "Changed"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Original</p>
            <div className="mt-2 space-y-2 text-sm text-[var(--ink-soft)]">
              <div>{comparison.originalRunId}</div>
              <div>Model: {comparison.originalModelName}</div>
              <div>Status: {comparison.originalStatus}</div>
              <div>
                Proposal: {comparison.originalProposalType ?? "none"} / {comparison.originalProposalState ?? "none"}
              </div>
              <div>Council steps: {comparison.originalCouncilSize}</div>
            </div>
          </div>

          <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Replay</p>
            <div className="mt-2 space-y-2 text-sm text-[var(--ink-soft)]">
              <div>{comparison.replayRunId}</div>
              <div>Model: {comparison.replayModelName}</div>
              <div>Status: {comparison.replayStatus}</div>
              <div>
                Proposal: {comparison.replayProposalType ?? "none"} / {comparison.replayProposalState ?? "none"}
              </div>
              <div>Council steps: {comparison.replayCouncilSize}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={diffVariant(comparison.sameWorkflow)}>Workflow</Badge>
          <Badge variant={diffVariant(comparison.samePrompt)}>Prompt</Badge>
          <Badge variant={diffVariant(comparison.sameContext)}>Context</Badge>
          <Badge variant={diffVariant(comparison.sameModel)}>Model</Badge>
          <Badge variant={diffVariant(comparison.sameStatus)}>Status</Badge>
          <Badge variant={diffVariant(comparison.sameProposalType)}>Proposal type</Badge>
          <Badge variant={diffVariant(comparison.sameProposalState)}>Proposal state</Badge>
          <Badge variant={diffVariant(comparison.sameCollaboration)}>Council</Badge>
          <Badge variant="neutral">Proposal items {deltaLabel(comparison.itemCountDelta)}</Badge>
        </div>

        {comparison.changedFields.length > 0 ? (
          <div className="grid gap-2">
            {comparison.changedFields.map((field) => (
              <div
                key={field}
                className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 py-2 text-sm text-[var(--ink-soft)]"
              >
                {field}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[12px] border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            Replay kept the same workflow, prompt, context, and council shape.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
