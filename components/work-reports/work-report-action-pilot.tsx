"use client";

import { useMemo } from "react";

import { WorkReportActionPilotAccessCard } from "@/components/work-reports/work-report-action-pilot-access-card";
import { useWorkReportActionPilotController } from "@/components/work-reports/work-report-action-pilot-controller";
import { WorkReportActionPilotOutputCard } from "@/components/work-reports/work-report-action-pilot-output-card";
import { WorkReportActionPilotRequestCard } from "@/components/work-reports/work-report-action-pilot-request-card";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type { WorkReportView } from "@/lib/work-reports/types";

export function WorkReportActionPilot({
  initialReportId,
  reports,
}: {
  initialReportId?: string | null;
  reports: WorkReportView[];
}) {
  const { accessProfile, allowed: canRunActionPilot } = usePlatformPermission(
    "REVIEW_WORK_REPORTS",
    "delivery"
  );
  const { accessProfile: telegramAccessProfile, allowed: canSendTelegram } = usePlatformPermission(
    "SEND_TELEGRAM_DIGESTS",
    "delivery"
  );
  const { accessProfile: emailAccessProfile, allowed: canSendEmail } = usePlatformPermission(
    "SEND_EMAIL_DIGESTS",
    "delivery"
  );

  const candidates = useMemo(
    () => reports.filter((report) => report.status === "approved"),
    [reports]
  );
  const {
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
    onApplyProposal,
    onCreatePacket,
    onDeliverEmail,
    onDeliverTelegram,
    onEmailDryRunChange,
    onEmailRecipientChange,
    onExportPacket,
    onRefreshHistory,
    onSelectedReportIdChange,
    onTelegramChatIdChange,
    onTelegramDryRunChange,
    onToggleTrace,
    packet,
    selectedReport,
    selectedReportId,
    selectedTraceRunId,
    telegramChatId,
    telegramDryRun,
    telegramResult,
    traceErrors,
    traces,
  } = useWorkReportActionPilotController({
    candidates,
    initialReportId,
  });

  if (!canRunActionPilot) {
    return <WorkReportActionPilotAccessCard role={accessProfile.role} />;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <WorkReportActionPilotRequestCard
        candidates={candidates}
        error={error}
        isSubmitting={isSubmitting}
        onCreatePacket={onCreatePacket}
        onSelectedReportIdChange={onSelectedReportIdChange}
        selectedReport={selectedReport}
        selectedReportId={selectedReportId}
      />

      <WorkReportActionPilotOutputCard
        applyingRunIds={applyingRunIds}
        canSendEmail={canSendEmail}
        canSendTelegram={canSendTelegram}
        deliveryHistory={deliveryHistory}
        emailAccessRole={emailAccessProfile.role}
        emailDryRun={emailDryRun}
        emailRecipient={emailRecipient}
        emailResult={emailResult}
        exportingFormat={exportingFormat}
        historyError={historyError}
        isDeliveringEmail={isDeliveringEmail}
        isDeliveringTelegram={isDeliveringTelegram}
        isLoadingHistory={isLoadingHistory}
        loadingTraceIds={loadingTraceIds}
        loadTrace={loadTrace}
        onApplyProposal={onApplyProposal}
        onDeliverEmail={onDeliverEmail}
        onDeliverTelegram={onDeliverTelegram}
        onEmailDryRunChange={onEmailDryRunChange}
        onEmailRecipientChange={onEmailRecipientChange}
        onExportPacket={onExportPacket}
        onRefreshHistory={onRefreshHistory}
        onTelegramChatIdChange={onTelegramChatIdChange}
        onTelegramDryRunChange={onTelegramDryRunChange}
        onToggleTrace={onToggleTrace}
        packet={packet}
        selectedTraceRunId={selectedTraceRunId}
        telegramAccessRole={telegramAccessProfile.role}
        telegramChatId={telegramChatId}
        telegramDryRun={telegramDryRun}
        telegramResult={telegramResult}
        traceErrors={traceErrors}
        traces={traces}
      />
    </div>
  );
}
