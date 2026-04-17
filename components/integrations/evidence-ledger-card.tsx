"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import type { EvidenceAnalysisResult, EvidenceListResult } from "@/lib/evidence";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";

import { EvidenceLedgerDetailPanel } from "./evidence-ledger-card-detail-panel";
import { EvidenceLedgerRecordList } from "./evidence-ledger-card-record-list";
import {
  formatConfidence,
  formatSyncStatus,
  formatTimestamp,
  matchesFilters,
  syncVariant,
  type EvidenceEntityFilter,
  type EvidenceLimitOption,
  type EvidenceStatusFilter,
} from "./evidence-ledger-card.utils";

export function EvidenceLedgerCard({
  evidence: initialEvidence,
}: {
  evidence: EvidenceListResult;
}) {
  const { allowed: canOperateEvidence } = usePlatformPermission("VIEW_CONNECTORS");
  const [evidence, setEvidence] = useState(initialEvidence);
  const [analysisByRecordId, setAnalysisByRecordId] = useState<
    Record<string, EvidenceAnalysisResult>
  >({});
  const [analysisErrorByRecordId, setAnalysisErrorByRecordId] = useState<Record<string, string>>(
    {}
  );
  const [analyzingRecordId, setAnalyzingRecordId] = useState<string | null>(null);
  const [entityTypeFilter, setEntityTypeFilter] = useState<EvidenceEntityFilter>("all");
  const [verificationStatusFilter, setVerificationStatusFilter] =
    useState<EvidenceStatusFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState<EvidenceLimitOption>("12");
  const [selectedRecordId, setSelectedRecordId] = useState<string>(
    () => initialEvidence.records[0]?.id ?? ""
  );
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
    () =>
      visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null,
    [selectedRecordId, visibleRecords]
  );
  const selectedAnalysis = selectedRecord ? analysisByRecordId[selectedRecord.id] : null;
  const selectedAnalysisError = selectedRecord ? analysisErrorByRecordId[selectedRecord.id] : "";
  const selectedMetadataEntries = selectedRecord
    ? Object.entries(selectedRecord.metadata)
        .filter(([, value]) => value !== null)
        .slice(0, 6)
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
                {evidence.sync?.lastResultCount !== null &&
                evidence.sync?.lastResultCount !== undefined
                  ? `${evidence.sync.lastResultCount} record${
                      evidence.sync.lastResultCount === 1 ? "" : "s"
                    }`
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
            <EvidenceLedgerRecordList
              analysisByRecordId={analysisByRecordId}
              onSelectRecord={setSelectedRecordId}
              selectedRecordId={selectedRecord?.id ?? selectedRecordId}
              visibleRecords={visibleRecords}
            />
            <EvidenceLedgerDetailPanel
              analyzingRecordId={analyzingRecordId}
              canOperateEvidence={canOperateEvidence}
              onAnalyzeRecord={analyzeRecord}
              selectedAnalysis={selectedAnalysis}
              selectedAnalysisError={selectedAnalysisError}
              selectedMetadataEntries={selectedMetadataEntries}
              selectedRecord={selectedRecord}
            />
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
