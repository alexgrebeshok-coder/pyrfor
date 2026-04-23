import { generatePortfolioBrief, generateProjectBrief } from './generate';
import {
  executeBriefDelivery,
  type BriefDeliveryLedgerRecord,
} from './delivery-ledger';
import { resolveBriefLocale, type BriefLocale } from './locale';
import {
  getTelegramDefaultChatId,
  getTelegramToken,
  sendTelegramTextMessage,
} from '../connectors/telegram-client';

type TelegramDeliveryScope = "portfolio" | "project";

export interface TelegramBriefDeliveryRequest {
  scope: TelegramDeliveryScope;
  projectId?: string;
  locale?: BriefLocale;
  chatId?: string | null;
  dryRun?: boolean;
  idempotencyKey?: string;
  scheduledPolicyId?: string | null;
}

export interface TelegramBriefDeliveryResult {
  scope: TelegramDeliveryScope;
  locale: BriefLocale;
  chatId: string | null;
  headline: string;
  delivered: boolean;
  dryRun: boolean;
  messageText: string;
  messageId?: number;
  replayed?: boolean;
  ledger?: BriefDeliveryLedgerRecord | null;
}

interface TelegramBriefDeliveryDeps {
  env?: NodeJS.ProcessEnv;
  sendMessage?: typeof sendTelegramTextMessage;
  generatePortfolio?: typeof generatePortfolioBrief;
  generateProject?: typeof generateProjectBrief;
}

export async function deliverBriefToTelegram(
  request: TelegramBriefDeliveryRequest,
  deps: TelegramBriefDeliveryDeps = {}
): Promise<TelegramBriefDeliveryResult> {
  const env = deps.env ?? process.env;
  const locale = resolveBriefLocale(request.locale);
  const generatePortfolio = deps.generatePortfolio ?? generatePortfolioBrief;
  const generateProject = deps.generateProject ?? generateProjectBrief;
  const sendMessage = deps.sendMessage ?? sendTelegramTextMessage;

  if (request.scope === "project" && !request.projectId) {
    throw new Error("projectId is required for project brief delivery.");
  }

  const brief =
    request.scope === "portfolio"
      ? await generatePortfolio({ locale })
      : await generateProject(request.projectId!, { locale });

  const messageText = brief.formats.telegramDigest;
  const chatId = request.chatId?.trim() || getTelegramDefaultChatId(env);
  const projectName = "project" in brief ? brief.project.name : null;

  if (!request.dryRun && !chatId) {
    throw new Error("Telegram chat id is required when no TELEGRAM_DEFAULT_CHAT_ID is configured.");
  }

  const token = request.dryRun ? null : getTelegramToken(env);
  if (!request.dryRun && !token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const execution = await executeBriefDelivery({
    channel: "telegram",
    provider: "telegram_bot_api",
    mode: request.scheduledPolicyId ? "scheduled" : "manual",
    scope: request.scope,
    projectId: request.projectId,
    projectName,
    locale,
    target: chatId ?? null,
    headline: brief.headline,
    content: {
      messageText,
    },
    requestPayload: {
      scope: request.scope,
      projectId: request.projectId ?? null,
      locale,
      chatId: chatId ?? null,
      dryRun: request.dryRun ?? false,
    },
    dryRun: request.dryRun,
    idempotencyKey: request.idempotencyKey,
    scheduledPolicyId: request.scheduledPolicyId,
    env,
    execute: async () => {
      const sendResult = await sendMessage({
        token: token!,
        chatId: chatId!,
        text: messageText,
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.message);
      }

      return {
        providerMessageId: sendResult.result.message_id,
        providerPayload: sendResult.result,
      };
    },
  });

  return {
    scope: request.scope,
    locale,
    chatId: chatId ? String(chatId) : null,
    headline: brief.headline,
    delivered: !request.dryRun,
    dryRun: request.dryRun ?? false,
    messageText,
    ...(execution.providerMessageId ? { messageId: Number(execution.providerMessageId) } : {}),
    replayed: execution.replayed,
    ledger: execution.ledger,
  };
}
