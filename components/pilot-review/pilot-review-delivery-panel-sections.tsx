import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type {
  PilotReviewDeliveryPolicyExecutionSummary,
  PilotReviewDeliveryPolicyRecord,
} from "@/lib/pilot-review";

import {
  deliveryStatusVariant,
  executionResultVariant,
  formatPolicySchedule,
  formatTimestamp,
} from "./pilot-review-delivery-panel-helpers";

export function PilotReviewDeliveryRunSummary({
  runSummary,
}: {
  runSummary: PilotReviewDeliveryPolicyExecutionSummary | null;
}) {
  if (!runSummary) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--ink)]">Latest run outcome</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            {formatTimestamp(runSummary.timestamp)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={runSummary.failedPolicies > 0 ? "danger" : "success"}>
            {runSummary.failedPolicies} failed
          </Badge>
          <Badge variant={runSummary.previewPolicies > 0 ? "info" : "neutral"}>
            {runSummary.previewPolicies} previewed
          </Badge>
          <Badge variant={runSummary.deliveredPolicies > 0 ? "success" : "neutral"}>
            {runSummary.deliveredPolicies} delivered
          </Badge>
          <Badge variant="neutral">{runSummary.skippedPolicies} skipped</Badge>
        </div>
      </div>
      <div className="grid gap-2 text-sm text-[var(--ink-soft)] md:grid-cols-3">
        <div>Checked: {runSummary.checkedPolicies}</div>
        <div>Due: {runSummary.duePolicies}</div>
        <div>Timestamp: {formatTimestamp(runSummary.timestamp)}</div>
      </div>
      <div className="grid gap-2">
        {runSummary.results.map((result) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 py-2 text-sm"
            key={`${result.policyId}:${result.reason}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={executionResultVariant(result.reason)}>{result.reason}</Badge>
              <span className="font-medium text-[var(--ink)]">{result.policyId}</span>
            </div>
            <div className="text-xs text-[var(--ink-soft)]">
              {result.error ?? (result.messageId ? `message ${result.messageId}` : "no error")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PilotReviewDeliveryPolicies({
  onToggle,
  policies,
  togglingPolicyId,
}: {
  onToggle: (policy: PilotReviewDeliveryPolicyRecord) => void;
  policies: PilotReviewDeliveryPolicyRecord[];
  togglingPolicyId: string | null;
}) {
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium text-[var(--ink)]">Weekly schedules</div>
      {policies.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          No weekly governance delivery schedules yet.
        </div>
      ) : (
        policies.map((policy) => (
          <div
            className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
            key={policy.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={policy.active ? "success" : "neutral"}>
                  {policy.active ? "Active" : "Paused"}
                </Badge>
                <Badge variant="info">{policy.channel}</Badge>
                <span className="text-xs text-[var(--ink-soft)]">
                  {formatPolicySchedule(policy)}
                </span>
              </div>
              <Button
                disabled={togglingPolicyId === policy.id}
                onClick={() => onToggle(policy)}
                size="sm"
                variant="secondary"
              >
                {togglingPolicyId === policy.id
                  ? "Updating..."
                  : policy.active
                    ? "Pause"
                    : "Resume"}
              </Button>
            </div>
            <div className="grid gap-1 text-xs text-[var(--ink-soft)] md:grid-cols-2">
              <div>Recipient: {policy.recipient ?? "EMAIL_DEFAULT_TO"}</div>
              <div>Workspace: {policy.workspaceId}</div>
              <div>Last attempt: {formatTimestamp(policy.lastAttemptAt)}</div>
              <div>Last delivered: {formatTimestamp(policy.lastDeliveredAt)}</div>
            </div>
            {policy.lastError ? (
              <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {policy.lastError}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

export function PilotReviewDeliveryHistory({
  history,
}: {
  history: BriefDeliveryLedgerRecord[];
}) {
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium text-[var(--ink)]">Governance delivery history</div>
      {history.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          No governance delivery ledger rows yet.
        </div>
      ) : (
        history.map((entry) => (
          <div
            className="grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
            key={entry.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={deliveryStatusVariant(entry.status)}>{entry.status}</Badge>
              <Badge variant="neutral">{entry.channel}</Badge>
              <Badge variant="neutral">{entry.mode}</Badge>
              <span className="text-xs text-[var(--ink-soft)]">attempts {entry.attemptCount}</span>
            </div>
            <div className="text-sm font-medium text-[var(--ink)]">{entry.headline}</div>
            <div className="grid gap-1 text-xs text-[var(--ink-soft)] md:grid-cols-2">
              <div>Target: {entry.target ?? "connector default"}</div>
              <div>Updated: {formatTimestamp(entry.updatedAt)}</div>
              <div>Delivered: {formatTimestamp(entry.deliveredAt)}</div>
              <div>Policy: {entry.scheduledPolicyId ?? "manual trigger"}</div>
            </div>
            {entry.lastError ? (
              <div className="text-sm text-[var(--danger-strong)]">{entry.lastError}</div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
