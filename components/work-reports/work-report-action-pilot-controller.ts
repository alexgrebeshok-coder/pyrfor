"use client";

import { useEffect, useState } from "react";

import type { AIRunTrace } from "@/lib/ai/trace";
import type { AIRunRecord } from "@/lib/ai/types";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { WorkReportSignalPacket, WorkReportView } from "@/lib/work-reports/types";
import type { WorkReportSignalPacketEmailDeliveryResult } from "@/lib/work-reports/signal-packet-email";
import type { WorkReportSignalPacketTelegramDeliveryResult } from "@/lib/work-reports/signal-packet-telegram";

export function useWorkReportActionPilotController({
  candidates,
  initialReportId,
}: {
  candidates: WorkReportView[];
  initialReportId?: string | null;
}) {
  const [selectedReportId, setSelectedReportId] = useState(() =>
    initialReportId && candidates.some((report) => report.id === initialReportId)
      ? initialReportId
      : candidates[0]?.id ?? ""
  );
  const [packet, setPacket] = useState<WorkReportSignalPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"markdown" | "json" | null>(null);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramDryRun, setTelegramDryRun] = useState(true);
  const [isDeliveringTelegram, setIsDeliveringTelegram] = useState(false);
  const [telegramResult, setTelegramResult] =
    useState<WorkReportSignalPacketTelegramDeliveryResult | null>(null);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailDryRun, setEmailDryRun] = useState(true);
  const [isDeliveringEmail, setIsDeliveringEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<WorkReportSignalPacketEmailDeliveryResult | null>(
    null
  );
  const [deliveryHistory, setDeliveryHistory] = useState<BriefDeliveryLedgerRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applyingRunIds, setApplyingRunIds] = useState<string[]>([]);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState<string | null>(null);
  const [loadingTraceIds, setLoadingTraceIds] = useState<string[]>([]);
  const [traceErrors, setTraceErrors] = useState<Record<string, string | null>>({});
  const [traces, setTraces] = useState<Record<string, AIRunTrace>>({});

  useEffect(() => {
    if (!selectedReportId || !candidates.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(candidates[0]?.id ?? "");
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

  const loadDeliveryHistory = async (nextPacket: WorkReportSignalPacket) => {
    setIsLoadingHistory(true);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/work-reports/${nextPacket.reportId}/signal-packet/delivery-history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: 6,
          packet: nextPacket,
        }),
      });
      const payload = (await response.json()) as
        | { history?: BriefDeliveryLedgerRecord[]; error?: { message?: string } }
        | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось загрузить delivery history.");
      }

      const successPayload = payload as { history?: BriefDeliveryLedgerRecord[] };
      setDeliveryHistory(successPayload.history ?? []);
    } catch (historyLoadingError) {
      setHistoryError(
        historyLoadingError instanceof Error
          ? historyLoadingError.message
          : "Не удалось загрузить delivery history."
      );
    } finally {
      setIsLoadingHistory(false);
    }
  };

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
          traceError instanceof Error ? traceError.message : "Не удалось загрузить trace summary.",
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

  const deliverTelegramPacket = async () => {
    if (!packet) {
      setError("Сначала соберите signal packet.");
      return;
    }

    setIsDeliveringTelegram(true);
    setError(null);

    try {
      const response = await fetch(`/api/work-reports/${packet.reportId}/signal-packet/telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale: "ru",
          chatId: telegramChatId.trim() || undefined,
          dryRun: telegramDryRun,
          packet,
        }),
      });
      const payload = (await response.json()) as
        | WorkReportSignalPacketTelegramDeliveryResult
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorPayload = payload as { error?: { message?: string } };
        throw new Error(
          errorPayload.error?.message ?? "Не удалось доставить signal packet в Telegram."
        );
      }

      setTelegramResult(payload as WorkReportSignalPacketTelegramDeliveryResult);
      await loadDeliveryHistory(packet);
    } catch (deliveryError) {
      setError(
        deliveryError instanceof Error
          ? deliveryError.message
          : "Не удалось доставить signal packet в Telegram."
      );
      await loadDeliveryHistory(packet);
    } finally {
      setIsDeliveringTelegram(false);
    }
  };

  const deliverEmailPacket = async () => {
    if (!packet) {
      setError("Сначала соберите signal packet.");
      return;
    }

    setIsDeliveringEmail(true);
    setError(null);

    try {
      const response = await fetch(`/api/work-reports/${packet.reportId}/signal-packet/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale: "ru",
          recipient: emailRecipient.trim() || undefined,
          dryRun: emailDryRun,
          packet,
        }),
      });
      const payload = (await response.json()) as
        | WorkReportSignalPacketEmailDeliveryResult
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorPayload = payload as { error?: { message?: string } };
        throw new Error(
          errorPayload.error?.message ?? "Не удалось доставить signal packet по email."
        );
      }

      setEmailResult(payload as WorkReportSignalPacketEmailDeliveryResult);
      await loadDeliveryHistory(packet);
    } catch (deliveryError) {
      setError(
        deliveryError instanceof Error
          ? deliveryError.message
          : "Не удалось доставить signal packet по email."
      );
      await loadDeliveryHistory(packet);
    } finally {
      setIsDeliveringEmail(false);
    }
  };

  const exportPacket = async (format: "markdown" | "json") => {
    if (!packet) {
      setError("Сначала соберите signal packet.");
      return;
    }

    setExportingFormat(format);
    setError(null);

    try {
      const response = await fetch(`/api/work-reports/${packet.reportId}/signal-packet/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format,
          packet,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload?.error?.message ?? "Не удалось экспортировать signal packet.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename=\"([^\"]+)\"/.exec(disposition);
      const fileName =
        match?.[1] ??
        `${packet.reportNumber.replace(/[^a-z0-9_-]+/gi, "-") || "work-report"}-signal-packet.${format === "json" ? "json" : "md"}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Не удалось экспортировать signal packet."
      );
    } finally {
      setExportingFormat(null);
    }
  };

  const createPacket = async () => {
    if (!selectedReportId) {
      setError("Выберите approved отчёт, чтобы собрать signal packet.");
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

      const nextPacket = payload as WorkReportSignalPacket;
      setPacket(nextPacket);
      setSelectedTraceRunId(null);
      setTraces({});
      setTraceErrors({});
      setTelegramResult(null);
      setEmailResult(null);
      setDeliveryHistory([]);
      setHistoryError(null);
      void loadDeliveryHistory(nextPacket);
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
      setError(applyError instanceof Error ? applyError.message : "Не удалось применить proposal.");
    } finally {
      setApplyingRunIds((current) => current.filter((item) => item !== runId));
    }
  };

  const reloadHistory = () => {
    if (packet) {
      void loadDeliveryHistory(packet);
    }
  };

  return {
    applyingRunIds,
    deliveryHistory,
    emailDryRun,
    emailRecipient,
    emailResult,
    error,
    exportingFormat,
    historyError,
    isDeliveringEmail,
    isDeliveringTelegram,
    isLoadingHistory,
    isSubmitting,
    loadTrace,
    loadingTraceIds,
    onApplyProposal: applyProposal,
    onCreatePacket: createPacket,
    onDeliverEmail: deliverEmailPacket,
    onDeliverTelegram: deliverTelegramPacket,
    onEmailDryRunChange: setEmailDryRun,
    onEmailRecipientChange: setEmailRecipient,
    onExportPacket: exportPacket,
    onRefreshHistory: reloadHistory,
    onSelectedReportIdChange: setSelectedReportId,
    onTelegramChatIdChange: setTelegramChatId,
    onTelegramDryRunChange: setTelegramDryRun,
    onToggleTrace: toggleTrace,
    packet,
    selectedReport,
    selectedReportId,
    selectedTraceRunId,
    telegramChatId,
    telegramDryRun,
    telegramResult,
    traceErrors,
    traces,
  };
}
