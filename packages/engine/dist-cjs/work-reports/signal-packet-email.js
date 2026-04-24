"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverWorkReportSignalPacketByEmail = deliverWorkReportSignalPacketByEmail;
const delivery_ledger_1 = require("../briefs/delivery-ledger");
const locale_1 = require("../briefs/locale");
const email_client_1 = require("../connectors/email-client");
const packet_export_1 = require("./packet-export");
const EMAIL_SUBJECT_LIMIT = 180;
const EMAIL_PREVIEW_LIMIT = 220;
function trimOptionalString(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
function truncateText(value, limit) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}
function buildDeliveryHeadline(packet) {
    return truncateText(`Signal packet ${packet.reportNumber} · ${packet.signal.headline}`, EMAIL_SUBJECT_LIMIT);
}
function buildPreviewText(packet) {
    return truncateText(packet.signal.summary, EMAIL_PREVIEW_LIMIT);
}
async function deliverWorkReportSignalPacketByEmail(request, deps = {}) {
    const env = deps.env ?? process.env;
    const sendMessage = deps.sendMessage ?? email_client_1.sendEmailTextMessage;
    const locale = (0, locale_1.resolveBriefLocale)(request.locale);
    const subject = buildDeliveryHeadline(request.packet);
    const previewText = buildPreviewText(request.packet);
    const bodyText = (0, packet_export_1.buildWorkReportSignalPacketMarkdown)(request.packet);
    const recipient = trimOptionalString(request.recipient) ?? (0, email_client_1.getEmailDefaultTo)(env);
    const dryRun = request.dryRun ?? false;
    if (!dryRun && !recipient) {
        throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
    }
    const config = dryRun ? null : (0, email_client_1.getEmailConnectorConfig)(env);
    if (!dryRun && !config) {
        throw new Error("SMTP is not configured.");
    }
    const execution = await (0, delivery_ledger_1.executeBriefDelivery)({
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
                config: config,
                to: recipient,
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
