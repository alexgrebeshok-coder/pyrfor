"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import type { WorkReportView } from "@/lib/work-reports/types";
import { formatDate, statusVariant } from "@/components/work-reports/work-report-action-pilot-utils";

export function WorkReportActionPilotRequestCard({
  candidates,
  error,
  isSubmitting,
  onCreatePacket,
  onSelectedReportIdChange,
  selectedReport,
  selectedReportId,
}: {
  candidates: WorkReportView[];
  error: string | null;
  isSubmitting: boolean;
  onCreatePacket: () => void;
  onSelectedReportIdChange: (value: string) => void;
  selectedReport: WorkReportView | null;
  selectedReportId: string;
}) {
  return (
    <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
      <CardHeader>
        <CardTitle>Work Report to Action</CardTitle>
        <CardDescription>
          Выберите approved полевой отчёт, и CEOClaw соберёт signal packet: execution patch,
          risk additions и executive status draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {candidates.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Нужен хотя бы один отчёт со статусом `approved`. Завершите review в панели выше.
          </div>
        ) : (
          <>
            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Полевой отчёт</span>
              <select
                className={fieldStyles}
                onChange={(event) => onSelectedReportIdChange(event.target.value)}
                value={selectedReportId}
              >
                {candidates.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.reportNumber} · {report.project.name} · {report.section}
                  </option>
                ))}
              </select>
            </label>

            {selectedReport ? (
              <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selectedReport.status)}>{selectedReport.status}</Badge>
                  <span className="text-xs text-[var(--ink-soft)]">
                    {selectedReport.project.name} · {formatDate(selectedReport.reportDate)}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--ink)]">
                    {selectedReport.reportNumber} · {selectedReport.section}
                  </div>
                  <div className="mt-1 text-sm text-[var(--ink-soft)]">
                    {selectedReport.workDescription}
                  </div>
                </div>
                {selectedReport.issues ? (
                  <div className="text-xs text-[var(--ink-soft)]">
                    <span className="font-medium text-[var(--ink)]">Блокеры:</span>{" "}
                    {selectedReport.issues}
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button disabled={!selectedReportId || isSubmitting} onClick={onCreatePacket}>
                {isSubmitting ? "Сборка..." : "Собрать signal packet"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
