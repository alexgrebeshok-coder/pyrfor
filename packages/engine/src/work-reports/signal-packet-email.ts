import {
  executeBriefDelivery,
  type BriefDeliveryLedgerRecord,
} from '../briefs/delivery-ledger';
import { resolveBriefLocale, type BriefLocale } from '../briefs/locale';
import {
  getEmailConnectorConfig,
  getEmailDefaultTo,
  sendEmailTextMessage,
} from '../connectors/email-client';
import { buildWorkReportSignalPacketMarkdown } from './packet-export';
import type { WorkReportSignalPacketPortable } from './types';

const EMAIL_SUBJECT_LIMIT = 180;
const EMAIL_PREVIEW_LIMIT = 220;

export interface WorkReportSignalPacketEmailDeliveryRequest {
  packet: WorkReportSignalPacketPortable;
  locale?: BriefLocale;
  recipient?: string | null;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export interface WorkReportSignalPacketEmailDeliveryResult {
  reportId: string;
  packetId: string;
  locale: BriefLocale;
  headline: string;
  delivered: boolean;
  dryRun: boolean;
  recipient: string | null;
  subject: string;
  previewText: string;
  bodyText: string;
  messageId?: string;
  replayed?: boolean;
  ledger?: BriefDeliveryLedgerRecord | null;
}

interface WorkReportSignalPacketEmailDeliveryDeps {
  env?: NodeJS.ProcessEnv;
  sendMessage?: typeof sendEmailTextMessage;
}

function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function truncateText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function buildDeliveryHeadline(packet: WorkReportSignalPacketPortable) {
  return truncateText(`Signal packet ${packet.reportNumber} · ${packet.signal.headline}`, EMAIL_SUBJECT_LIMIT);
}

function buildPreviewText(packet: WorkReportSignalPacketPortable) {
  return truncateText(packet.signal.summary, EMAIL_PREVIEW_LIMIT);
}

export async function deliverWorkReportSignalPacketByEmail(
  request: WorkReportSignalPacketEmailDeliveryRequest,
  deps: WorkReportSignalPacketEmailDeliveryDeps = {}
): Promise<WorkReportSignalPacketEmailDeliveryResult> {
  const env = deps.env ?? process.env;
  const sendMessage = deps.sendMessage ?? sendEmailTextMessage;
  const locale = resolveBriefLocale(request.locale);
  const subject = buildDeliveryHeadline(request.packet);
  const previewText = buildPreviewText(request.packet);
  const bodyText = buildWorkReportSignalPacketMarkdown(request.packet);
  const recipient = trimOptionalString(request.recipient) ?? getEmailDefaultTo(env);
  const dryRun = request.dryRun ?? false;

  if (!dryRun && !recipient) {
    throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
  }

  const config = dryRun ? null : getEmailConnectorConfig(env);
  if (!dryRun && !config) {
    throw new Error("SMTP is not configured.");
  }

  const execution = await executeBriefDelivery({
    channel: "email",
    provider: "smtp",
    mode: "manual",
    scope: "work_report",
    projectId: request.packet.projectId,
    projectName: request.packet.projectName,
    locale,
    target: recipient ?? null,
    headline: subject,
    content: {
      subject,
      previewText,
      bodyText,
    },
    requestPayload: {
      reportId: request.packet.reportId,
      packetId: request.packet.packetId,
      reportNumber: request.packet.reportNumber,
      projectId: request.packet.projectId,
      projectName: request.packet.projectName,
      locale,
      recipient: recipient ?? null,
      dryRun,
    },
    dryRun,
    idempotencyKey: request.idempotencyKey,
    env,
    execute: async () => {
      const sendResult = await sendMessage({
        config: config!,
        to: recipient!,
        subject,
        text: bodyText,
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.message);
      }

      return {
        providerMessageId: sendResult.messageId,
        providerPayload: {
          messageId: sendResult.messageId ?? null,
          previewText,
        },
      };
    },
  });

  return {
    reportId: request.packet.reportId,
    packetId: request.packet.packetId,
    locale,
    headline: subject,
    delivered: !dryRun,
    dryRun,
    recipient,
    subject,
    previewText,
    bodyText,
    ...(execution.providerMessageId ? { messageId: execution.providerMessageId } : {}),
    replayed: execution.replayed,
    ledger: execution.ledger,
  };
}
