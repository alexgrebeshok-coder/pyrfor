"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverBriefByEmail = deliverBriefByEmail;
const generate_1 = require("./generate");
const delivery_ledger_1 = require("./delivery-ledger");
const locale_1 = require("./locale");
const email_client_1 = require("../connectors/email-client");
async function deliverBriefByEmail(request, deps = {}) {
    const env = deps.env ?? process.env;
    const locale = (0, locale_1.resolveBriefLocale)(request.locale);
    const generatePortfolio = deps.generatePortfolio ?? generate_1.generatePortfolioBrief;
    const generateProject = deps.generateProject ?? generate_1.generateProjectBrief;
    const sendMessage = deps.sendMessage ?? email_client_1.sendEmailTextMessage;
    if (request.scope === "project" && !request.projectId) {
        throw new Error("projectId is required for project brief delivery.");
    }
    const brief = request.scope === "portfolio"
        ? await generatePortfolio({ locale })
        : await generateProject(request.projectId, { locale });
    const recipient = request.recipient?.trim() || (0, email_client_1.getEmailDefaultTo)(env);
    const projectName = "project" in brief ? brief.project.name : null;
    if (!request.dryRun && !recipient) {
        throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
    }
    const config = request.dryRun ? null : (0, email_client_1.getEmailConnectorConfig)(env);
    if (!request.dryRun && !config) {
        throw new Error("SMTP is not configured.");
    }
    const execution = await (0, delivery_ledger_1.executeBriefDelivery)({
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
            const sendResult = await sendMessage({
                config: config,
                to: recipient,
                subject: brief.formats.emailDigest.subject,
                text: brief.formats.emailDigest.body,
            });
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
