import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  TenantOnboardingOverview,
  TenantOnboardingRunbookRecord,
} from "@/lib/tenant-onboarding";

import {
  formatTimestamp,
  statusVariant,
} from "./tenant-onboarding-runbook-panel-helpers";

export function TenantOnboardingRunbookRecords({
  latestRunbook,
  onEdit,
  runbooks,
}: {
  latestRunbook: TenantOnboardingOverview["latestRunbook"];
  onEdit: (entry: TenantOnboardingRunbookRecord) => void;
  runbooks: TenantOnboardingRunbookRecord[];
}) {
  return (
    <div className="grid gap-4">
      {latestRunbook ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">Latest saved runbook</div>
              <div className="mt-1 text-xs text-[var(--ink-soft)]">
                Updated {formatTimestamp(latestRunbook.updatedAt)}
              </div>
            </div>
            <Badge variant={statusVariant(latestRunbook.status)}>
              {latestRunbook.statusLabel}
            </Badge>
          </div>
          <div className="mt-3 text-sm text-[var(--ink)]">{latestRunbook.summary}</div>
          <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)] md:grid-cols-2">
            <div>
              Baseline: {latestRunbook.baselineTenantSlug} · {latestRunbook.readinessOutcomeLabel}
            </div>
            <div>
              Target: {latestRunbook.targetTenantSlug ?? latestRunbook.targetTenantLabel ?? "Not set"}
            </div>
            <div>Review: {latestRunbook.reviewOutcomeLabel}</div>
            <div>Decision: {latestRunbook.latestDecisionLabel ?? "No decision snapshot"}</div>
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          No runbook has been saved yet. The template above is ready, but the handoff still
          depends on memory until a runbook entry is created.
        </div>
      )}

      <div className="grid gap-3">
        {runbooks.length > 0
          ? runbooks.map((entry) => (
              <div
                className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={entry.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--ink)]">{entry.summary}</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">
                      Updated {formatTimestamp(entry.updatedAt)}
                    </div>
                  </div>
                  <Badge variant={statusVariant(entry.status)}>{entry.statusLabel}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)] md:grid-cols-2">
                  <div>Target: {entry.targetTenantSlug ?? entry.targetTenantLabel ?? "Not set"}</div>
                  <div>Cutover: {formatTimestamp(entry.targetCutoverAt)}</div>
                  <div>
                    Snapshot: {entry.readinessOutcomeLabel} readiness · {entry.reviewOutcomeLabel}{" "}
                    review
                  </div>
                  <div>Decision: {entry.latestDecisionLabel ?? "No decision snapshot"}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => onEdit(entry)} type="button" variant="outline">
                    Edit
                  </Button>
                </div>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
