"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkReportActionPilotDeliveryPanel } from "@/components/work-reports/work-report-action-pilot-delivery-panel";
import {
  WorkReportActionPilotPacketAlerts,
  WorkReportActionPilotPacketRuns,
} from "@/components/work-reports/work-report-action-pilot-signal-panels";
import type { AIRunTrace } from "@/lib/ai/trace";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { WorkReportSignalPacket } from "@/lib/work-reports/types";
import type { WorkReportSignalPacketEmailDeliveryResult } from "@/lib/work-reports/signal-packet-email";
import type { WorkReportSignalPacketTelegramDeliveryResult } from "@/lib/work-reports/signal-packet-telegram";
function PacketSummaryPanel({
  exportingFormat,
  onExportPacket,
  packet,
}: {
  exportingFormat: "markdown" | "json" | null;
  onExportPacket: (format: "markdown" | "json") => void;
  packet: WorkReportSignalPacket;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="text-sm font-medium text-[var(--ink)]">{packet.signal.headline}</div>
      <div className="mt-2 text-sm text-[var(--ink-soft)]">{packet.signal.summary}</div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
        <span>Planned: {packet.signal.planFact.plannedProgress}%</span>
        <span>Actual: {packet.signal.planFact.actualProgress}%</span>
        <span>Variance: {packet.signal.planFact.progressVariance} pp</span>
        <span>Pending reports: {packet.signal.planFact.pendingWorkReports}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={exportingFormat !== null}
          onClick={() => onExportPacket("markdown")}
          size="sm"
          variant="outline"
        >
          {exportingFormat === "markdown" ? "Экспорт..." : "Export markdown"}
        </Button>
        <Button
          disabled={exportingFormat !== null}
          onClick={() => onExportPacket("json")}
          size="sm"
          variant="outline"
        >
          {exportingFormat === "json" ? "Экспорт..." : "Export JSON"}
        </Button>
      </div>
    </div>
  );
}

export function WorkReportActionPilotOutputCard({
  applyingRunIds,
  canSendEmail,
  canSendTelegram,
  deliveryHistory,
  emailAccessRole,
  emailDryRun,
  emailRecipient,
  emailResult,
  exportingFormat,
  historyError,
  isDeliveringEmail,
  isDeliveringTelegram,
  isLoadingHistory,
  loadingTraceIds,
  loadTrace,
  onApplyProposal,
  onDeliverEmail,
  onDeliverTelegram,
  onEmailDryRunChange,
  onEmailRecipientChange,
  onExportPacket,
  onRefreshHistory,
  onTelegramChatIdChange,
  onTelegramDryRunChange,
  onToggleTrace,
  packet,
  selectedTraceRunId,
  telegramAccessRole,
  telegramChatId,
  telegramDryRun,
  telegramResult,
  traceErrors,
  traces,
}: {
  applyingRunIds: string[];
  canSendEmail: boolean;
  canSendTelegram: boolean;
  deliveryHistory: BriefDeliveryLedgerRecord[];
  emailAccessRole: string;
  emailDryRun: boolean;
  emailRecipient: string;
  emailResult: WorkReportSignalPacketEmailDeliveryResult | null;
  exportingFormat: "markdown" | "json" | null;
  historyError: string | null;
  isDeliveringEmail: boolean;
  isDeliveringTelegram: boolean;
  isLoadingHistory: boolean;
  loadingTraceIds: string[];
  loadTrace: (runId: string) => Promise<void>;
  onApplyProposal: (runId: string, proposalId: string) => void;
  onDeliverEmail: () => void;
  onDeliverTelegram: () => void;
  onEmailDryRunChange: (value: boolean) => void;
  onEmailRecipientChange: (value: string) => void;
  onExportPacket: (format: "markdown" | "json") => void;
  onRefreshHistory: () => void;
  onTelegramChatIdChange: (value: string) => void;
  onTelegramDryRunChange: (value: boolean) => void;
  onToggleTrace: (runId: string) => void;
  packet: WorkReportSignalPacket | null;
  selectedTraceRunId: string | null;
  telegramAccessRole: string;
  telegramChatId: string;
  telegramDryRun: boolean;
  telegramResult: WorkReportSignalPacketTelegramDeliveryResult | null;
  traceErrors: Record<string, string | null>;
  traces: Record<string, AIRunTrace>;
}) {
  return (
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
            <PacketSummaryPanel
              exportingFormat={exportingFormat}
              onExportPacket={onExportPacket}
              packet={packet}
            />
            <WorkReportActionPilotDeliveryPanel
              canSendEmail={canSendEmail}
              canSendTelegram={canSendTelegram}
              deliveryHistory={deliveryHistory}
              emailAccessRole={emailAccessRole}
              emailDryRun={emailDryRun}
              emailRecipient={emailRecipient}
              emailResult={emailResult}
              historyError={historyError}
              isDeliveringEmail={isDeliveringEmail}
              isDeliveringTelegram={isDeliveringTelegram}
              isLoadingHistory={isLoadingHistory}
              onDeliverEmail={onDeliverEmail}
              onDeliverTelegram={onDeliverTelegram}
              onEmailDryRunChange={onEmailDryRunChange}
              onEmailRecipientChange={onEmailRecipientChange}
              onRefreshHistory={onRefreshHistory}
              onTelegramChatIdChange={onTelegramChatIdChange}
              onTelegramDryRunChange={onTelegramDryRunChange}
              telegramAccessRole={telegramAccessRole}
              telegramChatId={telegramChatId}
              telegramDryRun={telegramDryRun}
              telegramResult={telegramResult}
            />
            <WorkReportActionPilotPacketAlerts packet={packet} />
            <WorkReportActionPilotPacketRuns
              applyingRunIds={applyingRunIds}
              loadTrace={loadTrace}
              loadingTraceIds={loadingTraceIds}
              onApplyProposal={onApplyProposal}
              onToggleTrace={onToggleTrace}
              packet={packet}
              selectedTraceRunId={selectedTraceRunId}
              traceErrors={traceErrors}
              traces={traces}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
