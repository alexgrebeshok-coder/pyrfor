import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  EvidenceAnalysisItem,
  EvidenceAnalysisResult,
  EvidenceRecordView,
} from "@/lib/evidence";

import {
  entityTypeLabel,
  formatConfidence,
  formatMetadataValue,
  formatTimestamp,
  statusVariant,
} from "./evidence-ledger-card.utils";

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

export function EvidenceLedgerDetailPanel({
  selectedRecord,
  selectedAnalysis,
  selectedAnalysisError,
  selectedMetadataEntries,
  canOperateEvidence,
  analyzingRecordId,
  onAnalyzeRecord,
}: {
  selectedRecord: EvidenceRecordView | null;
  selectedAnalysis: EvidenceAnalysisResult | null;
  selectedAnalysisError: string;
  selectedMetadataEntries: Array<[string, string | number | boolean | null]>;
  canOperateEvidence: boolean;
  analyzingRecordId: string | null;
  onAnalyzeRecord: (recordId: string) => Promise<void>;
}) {
  return (
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
              onClick={() => void onAnalyzeRecord(selectedRecord.id)}
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
                        <div className="mt-2 font-medium text-[var(--ink)]">{source.title}</div>
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
  );
}
