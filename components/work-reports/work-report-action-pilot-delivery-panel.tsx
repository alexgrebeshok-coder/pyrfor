"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fieldStyles } from "@/components/ui/field";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { WorkReportSignalPacketEmailDeliveryResult } from "@/lib/work-reports/signal-packet-email";
import type { WorkReportSignalPacketTelegramDeliveryResult } from "@/lib/work-reports/signal-packet-telegram";
import {
  deliveryStatusLabel,
  deliveryStatusVariant,
  formatTimestamp,
  retryPostureLabel,
} from "@/components/work-reports/work-report-action-pilot-utils";

function TelegramHandoffCard({
  canSendTelegram,
  chatId,
  isDeliveringTelegram,
  onChatIdChange,
  onDeliverTelegram,
  onDryRunChange,
  telegramAccessRole,
  telegramDryRun,
  telegramResult,
}: {
  canSendTelegram: boolean;
  chatId: string;
  isDeliveringTelegram: boolean;
  onChatIdChange: (value: string) => void;
  onDeliverTelegram: () => void;
  onDryRunChange: (value: boolean) => void;
  telegramAccessRole: string;
  telegramDryRun: boolean;
  telegramResult: WorkReportSignalPacketTelegramDeliveryResult | null;
}) {
  return (
    <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div>
        <div className="text-sm font-medium text-[var(--ink)]">Telegram handoff</div>
        <div className="mt-1 text-xs text-[var(--ink-soft)]">
          Preview или live send в Telegram через существующий delivery ledger.
        </div>
      </div>
      {canSendTelegram ? (
        <>
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Chat ID override</span>
            <input
              className={fieldStyles}
              onChange={(event) => onChatIdChange(event.target.value)}
              placeholder="-1001234567890"
              value={chatId}
            />
          </label>
          <Checkbox
            checked={telegramDryRun}
            label="Dry run preview without sending"
            onChange={(event) => onDryRunChange(event.target.checked)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={isDeliveringTelegram}
              onClick={onDeliverTelegram}
              size="sm"
              variant={telegramDryRun ? "outline" : "default"}
            >
              {isDeliveringTelegram
                ? telegramDryRun
                  ? "Preview..."
                  : "Sending..."
                : telegramDryRun
                  ? "Preview Telegram delivery"
                  : "Send to Telegram"}
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          Роль {telegramAccessRole} может экспортировать packet, но не может отправлять Telegram
          handoff без permission `SEND_TELEGRAM_DIGESTS`.
        </div>
      )}
      {telegramResult ? (
        <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={telegramResult.delivered ? "success" : "info"}>
              {telegramResult.delivered ? "sent" : "preview"}
            </Badge>
            {telegramResult.replayed ? <Badge variant="neutral">replayed</Badge> : null}
            {telegramResult.ledger ? (
              <Badge variant="neutral">{telegramResult.ledger.status}</Badge>
            ) : null}
          </div>
          <div className="text-xs text-[var(--ink-muted)]">
            Target chat: {telegramResult.chatId ?? "env default not resolved"} · Locale:{" "}
            {telegramResult.locale}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] bg-[var(--panel-soft)] p-3 text-xs text-[var(--ink-soft)]">
            {telegramResult.messageText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function EmailHandoffCard({
  canSendEmail,
  emailAccessRole,
  emailDryRun,
  emailRecipient,
  isDeliveringEmail,
  onDeliverEmail,
  onDryRunChange,
  onRecipientChange,
  emailResult,
}: {
  canSendEmail: boolean;
  emailAccessRole: string;
  emailDryRun: boolean;
  emailRecipient: string;
  isDeliveringEmail: boolean;
  onDeliverEmail: () => void;
  onDryRunChange: (value: boolean) => void;
  onRecipientChange: (value: string) => void;
  emailResult: WorkReportSignalPacketEmailDeliveryResult | null;
}) {
  return (
    <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div>
        <div className="text-sm font-medium text-[var(--ink)]">Email handoff</div>
        <div className="mt-1 text-xs text-[var(--ink-soft)]">
          Preview или live send plain-text packet через SMTP connector.
        </div>
      </div>
      {canSendEmail ? (
        <>
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Email recipient override</span>
            <input
              className={fieldStyles}
              onChange={(event) => onRecipientChange(event.target.value)}
              placeholder="ops@example.com"
              type="email"
              value={emailRecipient}
            />
          </label>
          <Checkbox
            checked={emailDryRun}
            label="Dry run preview without sending"
            onChange={(event) => onDryRunChange(event.target.checked)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={isDeliveringEmail}
              onClick={onDeliverEmail}
              size="sm"
              variant={emailDryRun ? "outline" : "default"}
            >
              {isDeliveringEmail
                ? emailDryRun
                  ? "Preview..."
                  : "Sending..."
                : emailDryRun
                  ? "Preview email delivery"
                  : "Send by email"}
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          Роль {emailAccessRole} может работать с delivery workspace, но не может отправлять email
          handoff без permission `SEND_EMAIL_DIGESTS`.
        </div>
      )}
      {emailResult ? (
        <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={emailResult.delivered ? "success" : "info"}>
              {emailResult.delivered ? "sent" : "preview"}
            </Badge>
            {emailResult.replayed ? <Badge variant="neutral">replayed</Badge> : null}
            {emailResult.ledger ? <Badge variant="neutral">{emailResult.ledger.status}</Badge> : null}
          </div>
          <div className="text-xs text-[var(--ink-muted)]">
            Recipient: {emailResult.recipient ?? "env default not resolved"} · Locale:{" "}
            {emailResult.locale}
          </div>
          <div className="text-sm font-medium text-[var(--ink)]">{emailResult.subject}</div>
          <div className="text-xs text-[var(--ink-soft)]">{emailResult.previewText}</div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-[12px] bg-[var(--panel-soft)] p-3 text-xs text-[var(--ink-soft)]">
            {emailResult.bodyText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryHistoryPanel({
  deliveryHistory,
  historyError,
  isLoadingHistory,
  onRefreshHistory,
}: {
  deliveryHistory: BriefDeliveryLedgerRecord[];
  historyError: string | null;
  isLoadingHistory: boolean;
  onRefreshHistory: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--ink)]">Recent delivery history</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Последние записи work-report delivery ledger для текущего проекта.
          </div>
        </div>
        <Button disabled={isLoadingHistory} onClick={onRefreshHistory} size="sm" variant="outline">
          {isLoadingHistory ? "Refreshing..." : "Refresh history"}
        </Button>
      </div>
      {historyError ? (
        <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {historyError}
        </div>
      ) : null}
      {!historyError && deliveryHistory.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-panel)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          Пока нет delivery ledger entries для этого проекта.
        </div>
      ) : null}
      {!historyError
        ? deliveryHistory.map((entry) => (
            <div
              key={entry.id}
              className="grid gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={deliveryStatusVariant(entry.status)}>
                  {deliveryStatusLabel(entry.status)}
                </Badge>
                <Badge variant="neutral">{entry.channel}</Badge>
                <Badge variant={entry.retryPosture === "retryable" ? "warning" : "info"}>
                  {retryPostureLabel(entry.retryPosture)}
                </Badge>
              </div>
              <div className="text-sm font-medium text-[var(--ink)]">{entry.headline}</div>
              <div className="text-xs text-[var(--ink-soft)]">
                Target {entry.target ?? "connector default"} · updated {formatTimestamp(entry.updatedAt)}
                {" · "}attempts {entry.attemptCount}
                {entry.providerMessageId ? ` · provider ${entry.providerMessageId}` : ""}
              </div>
              {entry.lastError ? <div className="text-xs text-rose-700">{entry.lastError}</div> : null}
            </div>
          ))
        : null}
    </div>
  );
}

export function WorkReportActionPilotDeliveryPanel({
  canSendEmail,
  canSendTelegram,
  deliveryHistory,
  emailAccessRole,
  emailDryRun,
  emailRecipient,
  emailResult,
  historyError,
  isDeliveringEmail,
  isDeliveringTelegram,
  isLoadingHistory,
  onDeliverEmail,
  onDeliverTelegram,
  onEmailDryRunChange,
  onEmailRecipientChange,
  onRefreshHistory,
  onTelegramChatIdChange,
  onTelegramDryRunChange,
  telegramAccessRole,
  telegramChatId,
  telegramDryRun,
  telegramResult,
}: {
  canSendEmail: boolean;
  canSendTelegram: boolean;
  deliveryHistory: BriefDeliveryLedgerRecord[];
  emailAccessRole: string;
  emailDryRun: boolean;
  emailRecipient: string;
  emailResult: WorkReportSignalPacketEmailDeliveryResult | null;
  historyError: string | null;
  isDeliveringEmail: boolean;
  isDeliveringTelegram: boolean;
  isLoadingHistory: boolean;
  onDeliverEmail: () => void;
  onDeliverTelegram: () => void;
  onEmailDryRunChange: (value: boolean) => void;
  onEmailRecipientChange: (value: string) => void;
  onRefreshHistory: () => void;
  onTelegramChatIdChange: (value: string) => void;
  onTelegramDryRunChange: (value: boolean) => void;
  telegramAccessRole: string;
  telegramChatId: string;
  telegramDryRun: boolean;
  telegramResult: WorkReportSignalPacketTelegramDeliveryResult | null;
}) {
  return (
    <div className="mt-4 grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4">
      <div>
        <div className="text-sm font-medium text-[var(--ink)]">Delivery handoff</div>
        <div className="mt-1 text-sm text-[var(--ink-soft)]">
          Отправьте approved packet в delivery channels через общий delivery ledger или сначала
          проверьте preview без реальной отправки.
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TelegramHandoffCard
          canSendTelegram={canSendTelegram}
          chatId={telegramChatId}
          isDeliveringTelegram={isDeliveringTelegram}
          onChatIdChange={onTelegramChatIdChange}
          onDeliverTelegram={onDeliverTelegram}
          onDryRunChange={onTelegramDryRunChange}
          telegramAccessRole={telegramAccessRole}
          telegramDryRun={telegramDryRun}
          telegramResult={telegramResult}
        />
        <EmailHandoffCard
          canSendEmail={canSendEmail}
          emailAccessRole={emailAccessRole}
          emailDryRun={emailDryRun}
          emailRecipient={emailRecipient}
          isDeliveringEmail={isDeliveringEmail}
          onDeliverEmail={onDeliverEmail}
          onDryRunChange={onEmailDryRunChange}
          onRecipientChange={onEmailRecipientChange}
          emailResult={emailResult}
        />
      </div>
      <DeliveryHistoryPanel
        deliveryHistory={deliveryHistory}
        historyError={historyError}
        isLoadingHistory={isLoadingHistory}
        onRefreshHistory={onRefreshHistory}
      />
    </div>
  );
}
