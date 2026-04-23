import { generatePortfolioBrief, generateProjectBrief } from './generate';
import {
  executeBriefDelivery,
  type BriefDeliveryLedgerRecord,
} from './delivery-ledger';
import { resolveBriefLocale, type BriefLocale } from './locale';
import {
  getEmailConnectorConfig,
  getEmailDefaultTo,
  sendEmailTextMessage,
} from '../connectors/email-client';

type EmailDeliveryScope = "portfolio" | "project";

export interface EmailBriefDeliveryRequest {
  scope: EmailDeliveryScope;
  projectId?: string;
  locale?: BriefLocale;
  recipient?: string | null;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export interface EmailBriefDeliveryResult {
  scope: EmailDeliveryScope;
  locale: BriefLocale;
  recipient: string | null;
  headline: string;
  delivered: boolean;
  dryRun: boolean;
  subject: string;
  previewText: string;
  bodyText: string;
  messageId?: string;
  replayed?: boolean;
  ledger?: BriefDeliveryLedgerRecord | null;
}

interface EmailBriefDeliveryDeps {
  env?: NodeJS.ProcessEnv;
  generatePortfolio?: typeof generatePortfolioBrief;
  generateProject?: typeof generateProjectBrief;
  sendMessage?: typeof sendEmailTextMessage;
}

export async function deliverBriefByEmail(
  request: EmailBriefDeliveryRequest,
  deps: EmailBriefDeliveryDeps = {}
): Promise<EmailBriefDeliveryResult> {
  const env = deps.env ?? process.env;
  const locale = resolveBriefLocale(request.locale);
  const generatePortfolio = deps.generatePortfolio ?? generatePortfolioBrief;
  const generateProject = deps.generateProject ?? generateProjectBrief;
  const sendMessage = deps.sendMessage ?? sendEmailTextMessage;

  if (request.scope === "project" && !request.projectId) {
    throw new Error("projectId is required for project brief delivery.");
  }

  const brief =
    request.scope === "portfolio"
      ? await generatePortfolio({ locale })
      : await generateProject(request.projectId!, { locale });

  const recipient = request.recipient?.trim() || getEmailDefaultTo(env);
  const projectName = "project" in brief ? brief.project.name : null;

  if (!request.dryRun && !recipient) {
    throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
  }

  const config = request.dryRun ? null : getEmailConnectorConfig(env);
  if (!request.dryRun && !config) {
    throw new Error("SMTP is not configured.");
  }

  const execution = await executeBriefDelivery({
    channel: "email",
    provider: "smtp",
    mode: "manual",
    scope: request.scope,
    projectId: request.projectId,
    projectName,
    locale,
    target: recipient ?? null,
    headline: brief.headline,
    content: {
      subject: brief.formats.emailDigest.subject,
      previewText: brief.formats.emailDigest.preview,
      bodyText: brief.formats.emailDigest.body,
    },
    requestPayload: {
      scope: request.scope,
      projectId: request.projectId ?? null,
      locale,
      recipient: recipient ?? null,
      dryRun: request.dryRun ?? false,
    },
    dryRun: request.dryRun,
    idempotencyKey: request.idempotencyKey,
    env,
    execute: async () => {
      const sendResult = await sendMessage(
        {
          config: config!,
          to: recipient!,
          subject: brief.formats.emailDigest.subject,
          text: brief.formats.emailDigest.body,
        }
      );

      if (!sendResult.ok) {
        throw new Error(sendResult.message);
      }

      return {
        providerMessageId: sendResult.messageId,
        providerPayload: {
          messageId: sendResult.messageId ?? null,
        },
      };
    },
  });

  return {
    scope: request.scope,
    locale,
    recipient,
    headline: brief.headline,
    delivered: !request.dryRun,
    dryRun: request.dryRun ?? false,
    subject: brief.formats.emailDigest.subject,
    previewText: brief.formats.emailDigest.preview,
    bodyText: brief.formats.emailDigest.body,
    ...(execution.providerMessageId ? { messageId: execution.providerMessageId } : {}),
    replayed: execution.replayed,
    ledger: execution.ledger,
  };
}
