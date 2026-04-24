var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { executeBriefDelivery, } from '../briefs/delivery-ledger';
import { resolveBriefLocale } from '../briefs/locale';
import { getEmailConnectorConfig, getEmailDefaultTo, sendEmailTextMessage, } from '../connectors/email-client';
import { buildWorkReportSignalPacketMarkdown } from './packet-export';
const EMAIL_SUBJECT_LIMIT = 180;
const EMAIL_PREVIEW_LIMIT = 220;
function trimOptionalString(value) {
    const trimmed = value === null || value === void 0 ? void 0 : value.trim();
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
export function deliverWorkReportSignalPacketByEmail(request_1) {
    return __awaiter(this, arguments, void 0, function* (request, deps = {}) {
        var _a, _b, _c, _d;
        const env = (_a = deps.env) !== null && _a !== void 0 ? _a : process.env;
        const sendMessage = (_b = deps.sendMessage) !== null && _b !== void 0 ? _b : sendEmailTextMessage;
        const locale = resolveBriefLocale(request.locale);
        const subject = buildDeliveryHeadline(request.packet);
        const previewText = buildPreviewText(request.packet);
        const bodyText = buildWorkReportSignalPacketMarkdown(request.packet);
        const recipient = (_c = trimOptionalString(request.recipient)) !== null && _c !== void 0 ? _c : getEmailDefaultTo(env);
        const dryRun = (_d = request.dryRun) !== null && _d !== void 0 ? _d : false;
        if (!dryRun && !recipient) {
            throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
        }
        const config = dryRun ? null : getEmailConnectorConfig(env);
        if (!dryRun && !config) {
            throw new Error("SMTP is not configured.");
        }
        const execution = yield executeBriefDelivery({
            channel: "email",
            provider: "smtp",
            mode: "manual",
            scope: "work_report",
            projectId: request.packet.projectId,
            projectName: request.packet.projectName,
            locale,
            target: recipient !== null && recipient !== void 0 ? recipient : null,
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
                recipient: recipient !== null && recipient !== void 0 ? recipient : null,
                dryRun,
            },
            dryRun,
            idempotencyKey: request.idempotencyKey,
            env,
            execute: () => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const sendResult = yield sendMessage({
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
                        messageId: (_a = sendResult.messageId) !== null && _a !== void 0 ? _a : null,
                        previewText,
                    },
                };
            }),
        });
        return Object.assign(Object.assign({ reportId: request.packet.reportId, packetId: request.packet.packetId, locale, headline: subject, delivered: !dryRun, dryRun,
            recipient,
            subject,
            previewText,
            bodyText }, (execution.providerMessageId ? { messageId: execution.providerMessageId } : {})), { replayed: execution.replayed, ledger: execution.ledger });
    });
}
