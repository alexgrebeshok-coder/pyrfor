import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EvidenceAnalysisResult, EvidenceRecordView } from "@/lib/evidence";

import {
  entityTypeLabel,
  formatConfidence,
  formatTimestamp,
  statusVariant,
} from "./evidence-ledger-card.utils";

export function EvidenceLedgerRecordList({
  visibleRecords,
  selectedRecordId,
  analysisByRecordId,
  onSelectRecord,
}: {
  visibleRecords: EvidenceRecordView[];
  selectedRecordId: string;
  analysisByRecordId: Record<string, EvidenceAnalysisResult>;
  onSelectRecord: (recordId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      {visibleRecords.map((record) => {
        const isSelected = selectedRecordId === record.id;
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
                onClick={() => onSelectRecord(record.id)}
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
  );
}
