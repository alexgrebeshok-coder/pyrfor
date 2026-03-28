"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type {
  EvidenceAnalysisItem,
  EvidenceAnalysisResult,
  EvidenceListResult,
  EvidenceRecordView,
} from "@/lib/evidence";
import type { DerivedSyncStatus } from "@/lib/sync-state";

type EvidenceStatusFilter = "all" | EvidenceRecordView["verificationStatus"];
type EvidenceEntityFilter = "all" | "work_report" | "video_fact" | "gps_session";
type EvidenceLimitOption = "6" | "12" | "24";

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

function entityTypeLabel(value: EvidenceRecordView["entityType"]) {
  switch (value) {
    case "work_report":
      return "Work report";
    case "video_fact":
      return "Video fact";
    case "gps_session":
      return "GPS session";
    default:
      return value;
  }
}

function formatMetadataValue(value: string | number | boolean | null) {
  if (value === null) {
    return "null";
  }

  return String(value);
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
            <li
              className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
              key={`${item.code}:${item.message}`}
            >
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

function matchesFilters(
  record: EvidenceRecordView,
  filters: {
    entityType: EvidenceEntityFilter;
    verificationStatus: EvidenceStatusFilter;
  }
) {
  if (filters.verificationStatus !== "all" && record.verificationStatus !== filters.verificationStatus) {
    return false;
  }

  if (filters.entityType !== "all" && record.entityType !== filters.entityType) {
    return false;
  }

  return true;
}

export function EvidenceLedgerCard({
  evidence: initialEvidence,
}: {
  evidence: EvidenceListResult;
}) {
  const { allowed: canOperateEvidence } = usePlatformPermission("VIEW_CONNECTORS");
  const [evidence, setEvidence] = useState(initialEvidence);
  const [analysisByRecordId, setAnalysisByRecordId] = useState<Record<string, EvidenceAnalysisResult>>(
    {}
  );
  const [analysisErrorByRecordId, setAnalysisErrorByRecordId] = useState<Record<string, string>>(
    {}
  );
  const [analyzingRecordId, setAnalyzingRecordId] = useState<string | null>(null);
  const [entityTypeFilter, setEntityTypeFilter] = useState<EvidenceEntityFilter>("all");
  const [verificationStatusFilter, setVerificationStatusFilter] =
    useState<EvidenceStatusFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState<EvidenceLimitOption>("12");
  const [selectedRecordId, setSelectedRecordId] = useState<string>(() => initialEvidence.records[0]?.id ?? "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredRecords = useMemo(
    () =>
      evidence.records.filter((record) =>
        matchesFilters(record, {
          entityType: entityTypeFilter,
          verificationStatus: verificationStatusFilter,
        })
      ),
    [entityTypeFilter, evidence.records, verificationStatusFilter]
  );
  const visibleRecords = useMemo(
    () => filteredRecords.slice(0, Number(visibleLimit)),
    [filteredRecords, visibleLimit]
  );
  const selectedRecord = useMemo(
    () => visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null,
    [selectedRecordId, visibleRecords]
  );
  const selectedAnalysis = selectedRecord ? analysisByRecordId[selectedRecord.id] : null;
  const selectedAnalysisError = selectedRecord ? analysisErrorByRecordId[selectedRecord.id] : "";
  const selectedMetadataEntries = selectedRecord
    ? Object.entries(selectedRecord.metadata).filter(([, value]) => value !== null).slice(0, 6)
    : [];

  useEffect(() => {
    if (!selectedRecordId && visibleRecords[0]?.id) {
      setSelectedRecordId(visibleRecords[0].id);
      return;
    }

    if (selectedRecordId && visibleRecords.some((record) => record.id === selectedRecordId)) {
      return;
    }

    setSelectedRecordId(visibleRecords[0]?.id ?? "");
  }, [selectedRecordId, visibleRecords]);

  const syncEvidence = async () => {
    if (!canOperateEvidence) {
      return;
    }

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
    if (!canOperateEvidence) {
      return;
    }

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
              Provenance-слой поверх work reports, GPS sample и visual facts. Read path теперь
              только читает persisted ledger, а sync идёт отдельным job boundary.
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
            <Button
              disabled={!canOperateEvidence || isSyncing}
              onClick={syncEvidence}
              size="sm"
              variant="outline"
            >
              {isSyncing ? "Syncing..." : "Sync ledger"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">Operator focus</div>
              <div className="mt-1 text-xs text-[var(--ink-soft)]">
                Filter current ledger window, inspect one record deeply, then refresh its analysis on
                demand.
              </div>
            </div>
            <Badge variant="neutral">
              {filteredRecords.length} matched · showing {visibleRecords.length}
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Verification status</span>
              <select
                className={fieldStyles}
                onChange={(event) =>
                  setVerificationStatusFilter(event.target.value as EvidenceStatusFilter)
                }
                value={verificationStatusFilter}
              >
                <option value="all">All statuses</option>
                <option value="reported">Reported</option>
                <option value="observed">Observed</option>
                <option value="verified">Verified</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Entity type</span>
              <select
                className={fieldStyles}
                onChange={(event) => setEntityTypeFilter(event.target.value as EvidenceEntityFilter)}
                value={entityTypeFilter}
              >
                <option value="all">All entities</option>
                <option value="work_report">Work report</option>
                <option value="video_fact">Video fact</option>
                <option value="gps_session">GPS session</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Window size</span>
              <select
                className={fieldStyles}
                onChange={(event) => setVisibleLimit(event.target.value as EvidenceLimitOption)}
                value={visibleLimit}
              >
                <option value="6">6 records</option>
                <option value="12">12 records</option>
                <option value="24">24 records</option>
              </select>
            </label>
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

        {!canOperateEvidence ? (
          <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Sync и evidence analysis доступны только ролям с правом VIEW_CONNECTORS.
          </div>
        ) : null}

        {visibleRecords.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
            <div className="grid gap-3">
              {visibleRecords.map((record) => {
                const isSelected = selectedRecord?.id === record.id;
                const cachedAnalysis = analysisByRecordId[record.id];

                return (
                  <div
                    className={`rounded-[16px] border p-4 ${
                      isSelected
                        ? "border-[var(--line-strong)] bg-[var(--surface-panel-strong)]"
                        : "border-[var(--line)] bg-[var(--panel-soft)]"
                    }`}
                    key={record.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--ink)]">{record.title}</div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {entityTypeLabel(record.entityType)} · {record.sourceType}
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
                        onClick={() => setSelectedRecordId(record.id)}
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                      >
                        {isSelected ? "Selected" : "Inspect record"}
                      </Button>
                      {cachedAnalysis?.relatedSources.length ? (
                        <Badge variant="neutral">
                          {cachedAnalysis.relatedSources.length} supporting source
                          {cachedAnalysis.relatedSources.length === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              {selectedRecord ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--ink)]">Selected record</div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                        {selectedRecord.title}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {entityTypeLabel(selectedRecord.entityType)} · {selectedRecord.sourceType} ·{" "}
                        {selectedRecord.entityRef}
                      </div>
                    </div>
                    <Button
                      disabled={!canOperateEvidence || analyzingRecordId === selectedRecord.id}
                      onClick={() => void analyzeRecord(selectedRecord.id)}
                      size="sm"
                      variant="outline"
                    >
                      {analyzingRecordId === selectedRecord.id
                        ? "Analyzing..."
                        : selectedAnalysis
                          ? "Refresh analysis"
                          : "Analyze evidence"}
                    </Button>
                  </div>

                  <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(selectedRecord.verificationStatus)}>
                        {selectedRecord.verificationStatus}
                      </Badge>
                      <Badge variant="info">{formatConfidence(selectedRecord.confidence)}</Badge>
                      <Badge variant="neutral">{formatTimestamp(selectedRecord.observedAt)}</Badge>
                    </div>
                    {selectedRecord.summary ? (
                      <div className="text-sm text-[var(--ink-soft)]">{selectedRecord.summary}</div>
                    ) : (
                      <div className="text-sm text-[var(--ink-soft)]">
                        This record has no human summary yet.
                      </div>
                    )}
                  </div>

                  {selectedMetadataEntries.length > 0 ? (
                    <div className="grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                        Metadata
                      </div>
                      <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                        {selectedMetadataEntries.map(([key, value]) => (
                          <div
                            className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-[var(--panel-soft)] px-3 py-2"
                            key={key}
                          >
                            <span className="font-medium text-[var(--ink)]">{key}</span>
                            <span>{formatMetadataValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedAnalysisError ? (
                    <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {selectedAnalysisError}
                    </div>
                  ) : null}

                  {selectedAnalysis ? (
                    <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={statusVariant(selectedAnalysis.verificationStatus)}>
                          Final {selectedAnalysis.verificationStatus}
                        </Badge>
                        <Badge variant="info">
                          Base {formatConfidence(selectedAnalysis.baseConfidence)}
                        </Badge>
                        <Badge variant="success">
                          Final {formatConfidence(selectedAnalysis.finalConfidence)}
                        </Badge>
                        {selectedAnalysis.confidenceDelta > 0 ? (
                          <Badge variant="neutral">
                            +{formatConfidence(selectedAnalysis.confidenceDelta)}
                          </Badge>
                        ) : null}
                      </div>

                      <AnalysisList
                        emptyMessage="No confidence signals were detected yet."
                        items={selectedAnalysis.justifications}
                        title="Why it is trusted"
                      />

                      <AnalysisList
                        emptyMessage="No immediate evidence gaps were detected."
                        items={selectedAnalysis.gaps}
                        title="Coverage gaps"
                      />

                      <AnalysisList
                        emptyMessage="No anomalies were detected."
                        items={selectedAnalysis.anomalies}
                        title="Anomalies"
                      />

                      <div className="grid gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                          Related sources
                        </div>
                        {selectedAnalysis.relatedSources.length > 0 ? (
                          <div className="grid gap-2">
                            {selectedAnalysis.relatedSources.map((source) => (
                              <div
                                className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-3 text-sm text-[var(--ink-soft)]"
                                key={source.recordId}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={statusVariant(source.verificationStatus)}>
                                    {source.verificationStatus}
                                  </Badge>
                                  <Badge variant="info">{formatConfidence(source.confidence)}</Badge>
                                </div>
                                <div className="mt-2 font-medium text-[var(--ink)]">
                                  {source.title}
                                </div>
                                <div className="mt-1 text-xs">
                                  {entityTypeLabel(source.entityType)} · {source.sourceType}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-[12px] border border-dashed border-[var(--line)] px-3 py-2 text-sm text-[var(--ink-soft)]">
                            No supporting sources are attached to this record yet.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                      Выберите <span className="font-medium text-[var(--ink)]">Analyze evidence</span>,
                      чтобы раскрыть support, gaps и anomalies для выбранной записи.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                  Нет записей, соответствующих текущим фильтрам.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Ни одна запись не совпала с текущими фильтрами. Сбросьте фильтры или запустите свежий
            ledger sync.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
