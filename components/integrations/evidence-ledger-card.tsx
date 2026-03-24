"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  EvidenceAnalysisItem,
  EvidenceAnalysisResult,
  EvidenceListResult,
  EvidenceRecordView,
} from "@/lib/evidence";
import type { DerivedSyncStatus } from "@/lib/sync-state";

function statusVariant(status: EvidenceRecordView["verificationStatus"]) {
  switch (status) {
    case "verified":
      return "success";
    case "observed":
      return "info";
    case "reported":
    default:
      return "warning";
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

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
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

function formatSyncStatus(evidence: EvidenceListResult) {
  if (!evidence.sync) {
    return "Pending";
  }

  switch (evidence.sync.status) {
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

function AnalysisList({
  emptyMessage,
  items,
  title,
}: {
  emptyMessage: string;
  items: EvidenceAnalysisItem[];
  title: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
        {title}
      </div>
      {items.length > 0 ? (
        <ul className="grid gap-2 text-sm text-[var(--ink-soft)]">
          {items.map((item) => (
            <li className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2" key={`${item.code}:${item.message}`}>
              {item.message}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[var(--line)] px-3 py-2 text-sm text-[var(--ink-soft)]">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}

export function EvidenceLedgerCard({
  evidence: initialEvidence,
}: {
  evidence: EvidenceListResult;
}) {
  const [evidence, setEvidence] = useState(initialEvidence);
  const [analysisByRecordId, setAnalysisByRecordId] = useState<Record<string, EvidenceAnalysisResult>>(
    {}
  );
  const [analysisErrorByRecordId, setAnalysisErrorByRecordId] = useState<Record<string, string>>(
    {}
  );
  const [analyzingRecordId, setAnalyzingRecordId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRecords = evidence.records.slice(0, 6);

  const syncEvidence = async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch("/api/evidence/sync?limit=24", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось синхронизировать evidence ledger.");
      }

      setEvidence(payload as EvidenceListResult);
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Не удалось синхронизировать evidence ledger."
      );
      } finally {
        setIsSyncing(false);
      }
  };

  const analyzeRecord = async (recordId: string) => {
    setAnalyzingRecordId(recordId);
    setAnalysisErrorByRecordId((current) => ({
      ...current,
      [recordId]: "",
    }));

    try {
      const response = await fetch("/api/evidence/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ recordId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to analyze evidence.");
      }

      setAnalysisByRecordId((current) => ({
        ...current,
        [recordId]: payload as EvidenceAnalysisResult,
      }));
    } catch (analysisError) {
      setAnalysisErrorByRecordId((current) => ({
        ...current,
        [recordId]:
          analysisError instanceof Error ? analysisError.message : "Failed to analyze evidence.",
      }));
    } finally {
      setAnalyzingRecordId((current) => (current === recordId ? null : current));
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Evidence ledger</CardTitle>
            <CardDescription>
              Provenance-слой поверх work reports, GPS sample и visual facts. Read path теперь только читает persisted ledger, а sync идёт отдельным job boundary.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">Reported {evidence.summary.reported}</Badge>
            <Badge variant="info">Observed {evidence.summary.observed}</Badge>
            <Badge variant="success">Verified {evidence.summary.verified}</Badge>
            <Badge variant={syncVariant(evidence.sync?.status ?? "idle")}>
              Sync {formatSyncStatus(evidence)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="font-medium text-[var(--ink)]">Last sync</div>
            <div className="mt-1">{formatTimestamp(evidence.syncedAt)}</div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Average confidence</div>
            <div className="mt-1">
              {evidence.summary.averageConfidence !== null
                ? formatConfidence(evidence.summary.averageConfidence)
                : "Unavailable"}
            </div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Last observed fact</div>
            <div className="mt-1">{formatTimestamp(evidence.summary.lastObservedAt)}</div>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="font-medium text-[var(--ink)]">Last sync result</div>
              <div className="mt-1">
                {evidence.sync?.lastResultCount !== null && evidence.sync?.lastResultCount !== undefined
                  ? `${evidence.sync.lastResultCount} record${evidence.sync.lastResultCount === 1 ? "" : "s"}`
                  : "Unavailable"}
              </div>
            </div>
            <Button disabled={isSyncing} onClick={syncEvidence} size="sm" variant="outline">
              {isSyncing ? "Syncing..." : "Sync ledger"}
            </Button>
          </div>
        </div>

        {evidence.sync?.lastError ? (
          <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {evidence.sync.lastError}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}

        {visibleRecords.length > 0 ? (
          <div className="grid gap-3">
            {visibleRecords.map((record) => {
              const analysis = analysisByRecordId[record.id];
              const analysisError = analysisErrorByRecordId[record.id];

              return (
                <div
                  className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  key={record.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ink)]">{record.title}</div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {record.entityType} · {record.sourceType}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(record.verificationStatus)}>
                        {record.verificationStatus}
                      </Badge>
                      <Badge variant="info">{formatConfidence(record.confidence)}</Badge>
                    </div>
                  </div>

                  {record.summary ? (
                    <div className="mt-3 text-sm text-[var(--ink-soft)]">{record.summary}</div>
                  ) : null}

                  <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)]">
                    <div>Observed: {formatTimestamp(record.observedAt)}</div>
                    <div>Reported: {formatTimestamp(record.reportedAt)}</div>
                    <div>Entity ref: {record.entityRef}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      disabled={analyzingRecordId === record.id}
                      onClick={() => void analyzeRecord(record.id)}
                      size="sm"
                      variant="outline"
                    >
                      {analyzingRecordId === record.id
                        ? "Analyzing..."
                        : analysis
                          ? "Refresh analysis"
                          : "Analyze evidence"}
                    </Button>
                    {analysis?.relatedSources.length ? (
                      <Badge variant="neutral">
                        {analysis.relatedSources.length} supporting source
                        {analysis.relatedSources.length === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </div>

                  {analysisError ? (
                    <div className="mt-3 rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {analysisError}
                    </div>
                  ) : null}

                  {analysis ? (
                    <div className="mt-3 grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={statusVariant(analysis.verificationStatus)}>
                          Final {analysis.verificationStatus}
                        </Badge>
                        <Badge variant="info">Base {formatConfidence(analysis.baseConfidence)}</Badge>
                        <Badge variant="success">
                          Final {formatConfidence(analysis.finalConfidence)}
                        </Badge>
                        {analysis.confidenceDelta > 0 ? (
                          <Badge variant="neutral">
                            +{formatConfidence(analysis.confidenceDelta)}
                          </Badge>
                        ) : null}
                      </div>

                      <AnalysisList
                        emptyMessage="No confidence signals were detected yet."
                        items={analysis.justifications}
                        title="Why it is trusted"
                      />

                      <AnalysisList
                        emptyMessage="No immediate evidence gaps were detected."
                        items={analysis.gaps}
                        title="Coverage gaps"
                      />

                      <AnalysisList
                        emptyMessage="No anomalies were detected."
                        items={analysis.anomalies}
                        title="Anomalies"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Пока нет evidence records. Создайте work report, добавьте visual fact или запустите live ledger sync.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
