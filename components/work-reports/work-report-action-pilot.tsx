"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AIRunTracePanel } from "@/components/ai/ai-run-trace-panel";
import { fieldStyles } from "@/components/ui/field";
import type { AIRunTrace } from "@/lib/ai/trace";
import { getProposalItemCount, getProposalSafetyProfile } from "@/lib/ai/action-engine";
import type { AIRunRecord } from "@/lib/ai/types";
import type { WorkReportSignalPacket, WorkReportView } from "@/lib/work-reports/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function severityVariant(severity: "critical" | "high" | "medium" | "low") {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
    default:
      return "success";
  }
}

function statusVariant(status: WorkReportView["status"]) {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "submitted":
    default:
      return "warning";
  }
}

function safetyVariant(level: "low" | "medium" | "high") {
  switch (level) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
    default:
      return "info";
  }
}

function executionModeLabel(mode: "preview_only" | "guarded_patch" | "guarded_communication") {
  switch (mode) {
    case "preview_only":
      return "preview only";
    case "guarded_patch":
      return "guarded patch";
    case "guarded_communication":
      return "guarded communication";
  }
}

export function WorkReportActionPilot({
  initialReportId,
  reports,
}: {
  initialReportId?: string | null;
  reports: WorkReportView[];
}) {
  const candidates = useMemo(
    () => reports.filter((report) => report.status !== "rejected"),
    [reports]
  );
  const [selectedReportId, setSelectedReportId] = useState(() =>
    initialReportId && candidates.some((report) => report.id === initialReportId)
      ? initialReportId
      : candidates[0]?.id ?? ""
  );
  const [packet, setPacket] = useState<WorkReportSignalPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applyingRunIds, setApplyingRunIds] = useState<string[]>([]);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState<string | null>(null);
  const [loadingTraceIds, setLoadingTraceIds] = useState<string[]>([]);
  const [traceErrors, setTraceErrors] = useState<Record<string, string | null>>({});
  const [traces, setTraces] = useState<Record<string, AIRunTrace>>({});

  useEffect(() => {
    if (!selectedReportId && candidates[0]?.id) {
      setSelectedReportId(candidates[0].id);
    }
  }, [candidates, selectedReportId]);

  useEffect(() => {
    if (!packet) {
      return;
    }

    const pendingRuns = packet.runs.filter(
      (entry) => entry.run.status === "queued" || entry.run.status === "running"
    );
    if (pendingRuns.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const nextRuns = await Promise.all(
          packet.runs.map(async (entry) => {
            if (entry.run.status !== "queued" && entry.run.status !== "running") {
              return entry;
            }

            const response = await fetch(entry.pollPath, { cache: "no-store" });
            if (!response.ok) {
              return entry;
            }

            const run = (await response.json()) as AIRunRecord;
            return {
              ...entry,
              run,
            };
          })
        );

        setPacket((current) =>
          current
            ? {
                ...current,
                runs: nextRuns,
              }
            : current
        );
      } catch {
        // Keep the last visible packet state and allow a manual retry.
      }
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [packet]);

  const selectedReport =
    candidates.find((report) => report.id === selectedReportId) ?? candidates[0] ?? null;

  const loadTrace = async (runId: string) => {
    setLoadingTraceIds((current) => [...current, runId]);
    setTraceErrors((current) => ({
      ...current,
      [runId]: null,
    }));

    try {
      const response = await fetch(`/api/ai/runs/${runId}/trace`, { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось загрузить trace summary.");
      }

      setTraces((current) => ({
        ...current,
        [runId]: payload as AIRunTrace,
      }));
    } catch (traceError) {
      setTraceErrors((current) => ({
        ...current,
        [runId]:
          traceError instanceof Error
            ? traceError.message
            : "Не удалось загрузить trace summary.",
      }));
    } finally {
      setLoadingTraceIds((current) => current.filter((item) => item !== runId));
    }
  };

  const toggleTrace = async (runId: string) => {
    if (selectedTraceRunId === runId) {
      setSelectedTraceRunId(null);
      return;
    }

    setSelectedTraceRunId(runId);
    await loadTrace(runId);
  };

  const createPacket = async () => {
    if (!selectedReportId) {
      setError("Выберите отчёт, чтобы собрать signal packet.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/work-reports/${selectedReportId}/signal-packet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale: "ru",
          interfaceLocale: "ru",
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось собрать signal packet.");
      }

      setPacket(payload as WorkReportSignalPacket);
      setSelectedTraceRunId(null);
      setTraces({});
      setTraceErrors({});
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Не удалось собрать signal packet."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyProposal = async (runId: string, proposalId: string) => {
    setApplyingRunIds((current) => [...current, runId]);

    try {
      const response = await fetch(`/api/ai/runs/${runId}/proposals/${proposalId}/apply`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось применить proposal.");
      }

      const nextRun = payload as AIRunRecord;
      setPacket((current) =>
        current
          ? {
              ...current,
              runs: current.runs.map((entry) =>
                entry.run.id === runId
                  ? {
                      ...entry,
                      run: nextRun,
                    }
                  : entry
              ),
            }
          : current
      );

      if (selectedTraceRunId === runId) {
        await loadTrace(runId);
      }
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : "Не удалось применить proposal."
      );
    } finally {
      setApplyingRunIds((current) => current.filter((item) => item !== runId));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
        <CardHeader>
          <CardTitle>Work Report to Action</CardTitle>
          <CardDescription>
            Выберите полевой отчёт, и CEOClaw соберёт signal packet: execution patch, risk additions
            и executive status draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {candidates.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Нужен хотя бы один отчёт со статусом `submitted` или `approved`.
            </div>
          ) : (
            <>
              <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
                <span>Полевой отчёт</span>
                <select
                  className={fieldStyles}
                  onChange={(event) => setSelectedReportId(event.target.value)}
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
                <Button disabled={!selectedReportId || isSubmitting} onClick={createPacket}>
                  {isSubmitting ? "Сборка..." : "Собрать signal packet"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
        <CardHeader>
          <CardTitle>Packet Output</CardTitle>
          <CardDescription>
            Здесь появляются signal summary, top alerts и runs, которые можно применить после review.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!packet ? (
            <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Пока нет активного packet. Выберите отчёт слева и запустите сборку.
            </div>
          ) : (
            <>
              <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <div className="text-sm font-medium text-[var(--ink)]">{packet.signal.headline}</div>
                <div className="mt-2 text-sm text-[var(--ink-soft)]">{packet.signal.summary}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                  <span>Planned: {packet.signal.planFact.plannedProgress}%</span>
                  <span>Actual: {packet.signal.planFact.actualProgress}%</span>
                  <span>Variance: {packet.signal.planFact.progressVariance} pp</span>
                  <span>Pending reports: {packet.signal.planFact.pendingWorkReports}</span>
                </div>
              </div>

              {packet.signal.topAlerts.length > 0 ? (
                <div className="grid gap-3">
                  {packet.signal.topAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                        <span className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                          {alert.category}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium text-[var(--ink)]">{alert.title}</div>
                      <div className="mt-1 text-sm text-[var(--ink-soft)]">{alert.summary}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3">
                {packet.runs.map((entry) => {
                  const proposal = entry.run.result?.proposal ?? null;
                  const isApplying = applyingRunIds.includes(entry.run.id);
                  const canApply = proposal?.state === "pending";
                  const safety = proposal ? getProposalSafetyProfile(proposal) : null;

                  return (
                    <div
                      key={entry.run.id}
                      className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[var(--ink)]">{entry.label}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                            {entry.purpose} · {entry.run.status}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {proposal ? (
                            <Badge variant={proposal.state === "applied" ? "success" : "warning"}>
                              {proposal.type}
                            </Badge>
                          ) : null}
                          {safety ? (
                            <>
                              <Badge variant={safetyVariant(safety.level)}>
                                {safety.level} safety
                              </Badge>
                              <Badge variant="neutral">
                                {executionModeLabel(safety.executionMode)}
                              </Badge>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 text-sm text-[var(--ink-soft)]">
                        {entry.run.result?.summary ?? "AI run ещё не вернул summary."}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button
                          onClick={() => void toggleTrace(entry.run.id)}
                          size="sm"
                          variant="outline"
                        >
                          {selectedTraceRunId === entry.run.id ? "Hide trace" : "Open trace"}
                        </Button>
                        {canApply && proposal ? (
                          <Button
                            disabled={isApplying}
                            onClick={() => applyProposal(entry.run.id, proposal.id)}
                            size="sm"
                          >
                            {isApplying ? "Применение..." : "Apply proposal"}
                          </Button>
                        ) : null}
                      </div>

                      {proposal ? (
                        <div className="mt-3 grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
                          <div className="text-sm font-medium text-[var(--ink)]">{proposal.title}</div>
                          <div className="text-sm text-[var(--ink-soft)]">{proposal.summary}</div>
                          <div className="text-xs text-[var(--ink-muted)]">
                            Item count: {getProposalItemCount(proposal)}
                          </div>
                          {safety ? (
                            <div className="grid gap-2 text-xs text-[var(--ink-soft)]">
                              <div>Surface: {safety.mutationSurface}</div>
                              <div>Compensation: {safety.compensationSummary}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {selectedTraceRunId === entry.run.id ? (
                        <AIRunTracePanel
                          error={traceErrors[entry.run.id]}
                          isLoading={loadingTraceIds.includes(entry.run.id)}
                          onRefresh={() => void loadTrace(entry.run.id)}
                          trace={traces[entry.run.id] ?? null}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
