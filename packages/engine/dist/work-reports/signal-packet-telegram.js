var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { executeBriefDelivery, } from '../briefs/delivery-ledger.js';
import { resolveBriefLocale } from '../briefs/locale.js';
import { getTelegramDefaultChatId, getTelegramToken, sendTelegramTextMessage, } from '../connectors/telegram-client.js';
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_ALERT_LIMIT = 3;
const TELEGRAM_RUN_LIMIT = 3;
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
function clampTelegramMessage(value) {
    if (value.length <= TELEGRAM_MESSAGE_LIMIT) {
        return value;
    }
    return `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - 33).trimEnd()}\n\n[message truncated for Telegram]`;
}
function buildDeliveryHeadline(packet) {
    return truncateText(`Signal packet ${packet.reportNumber} · ${packet.signal.headline}`, 180);
}
function buildWorkReportSignalPacketTelegramDigest(packet) {
    var _a;
    const lines = [
        `Полевой сигнал ${packet.reportNumber}`,
        `Проект: ${packet.projectName}`,
        `Статус отчёта: ${packet.reportStatus}`,
        `Дата отчёта: ${packet.signal.reportDate}`,
        "",
        truncateText(packet.signal.headline, 180),
        "",
        truncateText(packet.signal.summary, 480),
        "",
        `План/факт: ${packet.signal.planFact.plannedProgress}% план · ${packet.signal.planFact.actualProgress}% факт · ${packet.signal.planFact.progressVariance} pp`,
        `Ожидает отчётов: ${packet.signal.planFact.pendingWorkReports}`,
        `Дней с последнего approved: ${(_a = packet.signal.planFact.daysSinceLastApprovedReport) !== null && _a !== void 0 ? _a : "n/a"}`,
        "",
        "Top alerts:",
    ];
    const alerts = packet.signal.topAlerts.slice(0, TELEGRAM_ALERT_LIMIT);
    if (alerts.length === 0) {
        lines.push("- Нет активных alert'ов.");
    }
    else {
        alerts.forEach((alert, index) => {
            lines.push(`${index + 1}. [${alert.severity.toUpperCase()}] ${truncateText(alert.title, 90)} — ${truncateText(alert.summary, 160)}`);
        });
    }
    if (packet.signal.topAlerts.length > alerts.length) {
        lines.push(`+ ещё ${packet.signal.topAlerts.length - alerts.length} alert.`);
    }
    lines.push("", "AI runs:");
    const runs = packet.runs.slice(0, TELEGRAM_RUN_LIMIT);
    runs.forEach((entry) => {
        var _a, _b, _c;
        lines.push(`- ${entry.label} (${entry.run.status}): ${truncateText((_b = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.summary) !== null && _b !== void 0 ? _b : "AI run ещё не вернул summary.", 160)}`);
        if ((_c = entry.run.result) === null || _c === void 0 ? void 0 : _c.proposal) {
            lines.push(`  Proposal: ${truncateText(entry.run.result.proposal.title, 80)} [${entry.run.result.proposal.state}]`);
        }
    });
    if (packet.runs.length > runs.length) {
        lines.push(`+ ещё ${packet.runs.length - runs.length} run.`);
    }
    return clampTelegramMessage(`${lines.join("\n")}\n`);
}
export function deliverWorkReportSignalPacketToTelegram(request_1) {
    return __awaiter(this, arguments, void 0, function* (request, deps = {}) {
        var _a, _b, _c, _d;
        const env = (_a = deps.env) !== null && _a !== void 0 ? _a : process.env;
        const sendMessage = (_b = deps.sendMessage) !== null && _b !== void 0 ? _b : sendTelegramTextMessage;
        const locale = resolveBriefLocale(request.locale);
        const messageText = buildWorkReportSignalPacketTelegramDigest(request.packet);
        const chatId = (_c = trimOptionalString(request.chatId)) !== null && _c !== void 0 ? _c : getTelegramDefaultChatId(env);
        const dryRun = (_d = request.dryRun) !== null && _d !== void 0 ? _d : false;
        if (!dryRun && !chatId) {
            throw new Error("Telegram chat id is required when no TELEGRAM_DEFAULT_CHAT_ID is configured.");
        }
        const token = dryRun ? null : getTelegramToken(env);
        if (!dryRun && !token) {
            throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
        }
        const execution = yield executeBriefDelivery({
            channel: "telegram",
            provider: "telegram_bot_api",
            mode: "manual",
            scope: "work_report",
            projectId: request.packet.projectId,
            projectName: request.packet.projectName,
            locale,
            target: chatId !== null && chatId !== void 0 ? chatId : null,
            headline: buildDeliveryHeadline(request.packet),
            content: {
                messageText,
            },
            requestPayload: {
                reportId: request.packet.reportId,
                packetId: request.packet.packetId,
                reportNumber: request.packet.reportNumber,
                projectId: request.packet.projectId,
                projectName: request.packet.projectName,
                locale,
                chatId: chatId !== null && chatId !== void 0 ? chatId : null,
                dryRun,
            },
            dryRun,
            idempotencyKey: request.idempotencyKey,
            env,
            execute: () => __awaiter(this, void 0, void 0, function* () {
                const sendResult = yield sendMessage({
                    token: token,
                    chatId: chatId,
                    text: messageText,
                });
                if (!sendResult.ok) {
                    throw new Error(sendResult.message);
                }
                return {
                    providerMessageId: sendResult.result.message_id,
                    providerPayload: sendResult.result,
                };
            }),
        });
        return Object.assign(Object.assign({ reportId: request.packet.reportId, packetId: request.packet.packetId, locale, headline: buildDeliveryHeadline(request.packet), delivered: !dryRun, dryRun, chatId: chatId ? String(chatId) : null, messageText }, (execution.providerMessageId ? { messageId: Number(execution.providerMessageId) } : {})), { replayed: execution.replayed, ledger: execution.ledger });
    });
}
