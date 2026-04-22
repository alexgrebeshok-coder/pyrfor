import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import {
  executeBriefDelivery,
  listBriefDeliveryLedger,
  type BriefDeliveryExecutionInput,
  type BriefDeliveryExecutionOutcome,
} from "@/lib/briefs/delivery-ledger";
import { getEmailConnectorConfig, getEmailDefaultTo, sendEmailTextMessage } from "@/lib/connectors/email-client";
import { getPilotTenantSlug } from "@/lib/server/pilot-controls";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

import { getPilotReviewScorecard } from "./service";
import type { PilotReviewEmailDeliveryResult, PilotReviewScorecard } from "./types";

interface DeliverPilotReviewByEmailRequest {
  accessProfile?: AccessProfile;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  idempotencyKey?: string;
  recipient?: string | null;
  scheduledPolicyId?: string | null;
}

interface PilotReviewEmailDeliveryDeps {
  executeDelivery?: (input: BriefDeliveryExecutionInput) => Promise<BriefDeliveryExecutionOutcome>;
  getScorecard?: (input: {
    accessProfile: AccessProfile;
    env?: NodeJS.ProcessEnv;
  }) => Promise<PilotReviewScorecard>;
  sendMessage?: typeof sendEmailTextMessage;
}

export async function deliverPilotReviewByEmail(
  request: DeliverPilotReviewByEmailRequest = {},
  deps: PilotReviewEmailDeliveryDeps = {}
): Promise<PilotReviewEmailDeliveryResult> {
  const env = request.env ?? process.env;
  const accessProfile =
    request.accessProfile ??
    buildAccessProfile({
      organizationSlug: getPilotTenantSlug(env) ?? undefined,
      role: "EXEC",
      userId: "system:pilot-review-delivery",
      workspaceId: "executive",
    });
  const getScorecard =
    deps.getScorecard ??
    (async (input: { accessProfile: AccessProfile; env?: NodeJS.ProcessEnv }) =>
      getPilotReviewScorecard({
        accessProfile: input.accessProfile,
        env: input.env,
        runtime: getServerRuntimeState(input.env),
      }));
  const executeDelivery = deps.executeDelivery ?? executeBriefDelivery;
  const sendMessage = deps.sendMessage ?? sendEmailTextMessage;
  const scorecard = await getScorecard({
    accessProfile,
    env,
  });
  const recipient = request.recipient?.trim() || getEmailDefaultTo(env);
  const headline = `Pilot review · ${scorecard.readiness.tenant.slug}`;
  const subject = `[Pilot Review] ${scorecard.readiness.tenant.slug} · ${scorecard.outcomeLabel}`;
  const previewText = buildPreviewText(scorecard);
  const bodyText = scorecard.artifact.content;

  if (!request.dryRun && !recipient) {
    throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
  }

  const config = request.dryRun ? null : getEmailConnectorConfig(env);
  if (!request.dryRun && !config) {
    throw new Error("SMTP is not configured.");
  }

  const execution = await executeDelivery({
    channel: "email",
    provider: "smtp",
    mode: request.scheduledPolicyId ? "scheduled" : "manual",
    scope: "governance",
    projectId: null,
    projectName: scorecard.readiness.tenant.slug,
    locale: "en",
    target: recipient ?? null,
    headline,
    content: {
      bodyText,
      previewText,
      subject,
    },
    requestPayload: {
      artifactFileName: scorecard.artifact.fileName,
      dryRun: request.dryRun ?? false,
      generatedAt: scorecard.generatedAt,
      kind: "pilot_review",
      outcome: scorecard.outcome,
      recipient: recipient ?? null,
      tenantSlug: scorecard.readiness.tenant.slug,
    },
    dryRun: request.dryRun,
    idempotencyKey: request.idempotencyKey,
    scheduledPolicyId: request.scheduledPolicyId,
    env,
    execute: async () => {
      const sendResult = await sendMessage({
        config: config!,
        subject,
        text: bodyText,
        to: recipient!,
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.message);
      }

      return {
        providerMessageId: sendResult.messageId,
        providerPayload: {
          artifactFileName: scorecard.artifact.fileName,
          messageId: sendResult.messageId ?? null,
          outcome: scorecard.outcome,
          tenantSlug: scorecard.readiness.tenant.slug,
        },
      };
    },
  });

  return {
    bodyText,
    delivered: !request.dryRun,
    dryRun: request.dryRun ?? false,
    headline,
    ledger: execution.ledger,
    ...(execution.providerMessageId ? { messageId: execution.providerMessageId } : {}),
    previewText,
    recipient,
    replayed: execution.replayed,
    scorecard: {
      generatedAt: scorecard.generatedAt,
      outcome: scorecard.outcome,
      outcomeLabel: scorecard.outcomeLabel,
      tenantSlug: scorecard.readiness.tenant.slug,
    },
    subject,
  };
}

export async function listPilotReviewDeliveryHistory(limit = 8) {
  return listBriefDeliveryLedger({
    limit,
    scope: "governance",
  });
}

function buildPreviewText(scorecard: PilotReviewScorecard) {
  const activeConcerns = scorecard.summary.openExceptions + scorecard.summary.openFeedback;
  return [
    `Outcome ${scorecard.outcomeLabel}`,
    `${scorecard.summary.blockedSections} blocked section${scorecard.summary.blockedSections === 1 ? "" : "s"}`,
    `${scorecard.summary.warningSections} warning section${scorecard.summary.warningSections === 1 ? "" : "s"}`,
    `${activeConcerns} active concern${activeConcerns === 1 ? "" : "s"}`,
  ].join(" · ");
}
