"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type {
  ReconciliationCasefileListResult,
  ReconciliationCasefileView,
} from "@/lib/enterprise-truth";
import type { DerivedSyncStatus } from "@/lib/sync-state";

function truthVariant(status: ReconciliationCasefileView["truthStatus"]) {
  switch (status) {
    case "corroborated":
      return "success";
    case "contradictory":
      return "danger";
    case "partial":
    default:
      return "warning";
  }
}

function caseTypeVariant(caseType: ReconciliationCasefileView["caseType"]) {
  switch (caseType) {
    case "telemetry_gap":
      return "info";
    case "project_case":
    default:
      return "neutral";
  }
}

function syncVariant(status: DerivedSyncStatus) {
  switch (status) {
    case "success":
      return "success";
    case "running":
      return "info";
    case "error":
      return "danger";
    case "idle":
    default:
      return "neutral";
  }
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSyncStatus(result: ReconciliationCasefileListResult) {
  if (!result.sync) {
    return "Pending";
  }

  switch (result.sync.status) {
    case "success":
      return "Success";
    case "running":
      return "Running";
    case "error":
      return "Failed";
    case "idle":
    default:
      return "Idle";
  }
}

export function ReconciliationCasefilesCard({
  result: initialResult,
}: {
  result: ReconciliationCasefileListResult;
}) {
  const { allowed: canSyncCasefiles } = usePlatformPermission("VIEW_CONNECTORS");
  const [result, setResult] = useState(initialResult);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unresolvedCases = useMemo(
    () => result.cases.filter((item) => item.resolutionStatus === "open").slice(0, 6),
    [result]
  );

  const syncCases = async () => {
    if (!canSyncCasefiles) {
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch("/api/reconciliation/sync?limit=24", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Не удалось синхронизировать reconciliation casefiles."
        );
      }

      setResult(payload as ReconciliationCasefileListResult);
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Не удалось синхронизировать reconciliation casefiles."
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Reconciliation casefiles</CardTitle>
            <CardDescription>
              Persisted case-level truth layer поверх finance, field evidence и telemetry. Здесь видно, почему конкретный случай считается corroborated, partial или contradictory.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="danger">Contradictory {result.summary.contradictory}</Badge>
            <Badge variant="warning">Partial {result.summary.partial}</Badge>
            <Badge variant="success">Corroborated {result.summary.corroborated}</Badge>
            <Badge variant={syncVariant(result.sync?.status ?? "idle")}>
              Sync {formatSyncStatus(result)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="font-medium text-[var(--ink)]">Last sync</div>
            <div className="mt-1">{formatTimestamp(result.syncedAt)}</div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Open cases</div>
            <div className="mt-1">{result.summary.open}</div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Telemetry gaps</div>
            <div className="mt-1">{result.summary.telemetryGaps}</div>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="font-medium text-[var(--ink)]">Last sync result</div>
              <div className="mt-1">
                {result.sync?.lastResultCount !== null &&
                result.sync?.lastResultCount !== undefined
                  ? `${result.sync.lastResultCount} case${result.sync.lastResultCount === 1 ? "" : "s"}`
                  : "Unavailable"}
              </div>
            </div>
            <Button
              disabled={!canSyncCasefiles || isSyncing}
              onClick={syncCases}
              size="sm"
              variant="outline"
            >
              {isSyncing ? "Syncing..." : "Sync cases"}
            </Button>
          </div>
        </div>

        {!canSyncCasefiles ? (
          <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Reconciliation sync доступен только ролям с правом VIEW_CONNECTORS.
          </div>
        ) : null}

        {result.sync?.lastError ? (
          <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {result.sync.lastError}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}

        {unresolvedCases.length > 0 ? (
          <div className="grid gap-3">
            {unresolvedCases.map((item) => (
              <div
                className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--ink)]">{item.title}</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">
                      {item.projectName ?? "No linked project"}
                      {item.financeProjectId ? ` · Finance ${item.financeProjectId}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={truthVariant(item.truthStatus)}>{item.truthStatus}</Badge>
                    <Badge variant={caseTypeVariant(item.caseType)}>{item.caseType}</Badge>
                  </div>
                </div>

                <div className="mt-3 text-sm text-[var(--ink-soft)]">{item.explanation}</div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {item.reasonCodes.map((code) => (
                    <Badge key={code} variant="neutral">
                      {code}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)] md:grid-cols-2 xl:grid-cols-4">
                  <div>Evidence refs: {item.evidenceRecordIds.length}</div>
                  <div>Fusion refs: {item.fusionFactIds.length}</div>
                  <div>Telemetry refs: {item.telemetryRefs.length}</div>
                  <div>Observed: {formatTimestamp(item.lastObservedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            No unresolved reconciliation cases yet. Run sync or wait for new finance, field, or telemetry facts.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
