"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverWorkReportSignalPacketToTelegram = deliverWorkReportSignalPacketToTelegram;
const delivery_ledger_1 = require("../briefs/delivery-ledger");
const locale_1 = require("../briefs/locale");
const telegram_client_1 = require("../connectors/telegram-client");
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_ALERT_LIMIT = 3;
const TELEGRAM_RUN_LIMIT = 3;
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
        `Дней с последнего approved: ${packet.signal.planFact.daysSinceLastApprovedReport ?? "n/a"}`,
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
        lines.push(`- ${entry.label} (${entry.run.status}): ${truncateText(entry.run.result?.summary ?? "AI run ещё не вернул summary.", 160)}`);
        if (entry.run.result?.proposal) {
            lines.push(`  Proposal: ${truncateText(entry.run.result.proposal.title, 80)} [${entry.run.result.proposal.state}]`);
        }
    });
    if (packet.runs.length > runs.length) {
        lines.push(`+ ещё ${packet.runs.length - runs.length} run.`);
    }
    return clampTelegramMessage(`${lines.join("\n")}\n`);
}
async function deliverWorkReportSignalPacketToTelegram(request, deps = {}) {
    const env = deps.env ?? process.env;
    const sendMessage = deps.sendMessage ?? telegram_client_1.sendTelegramTextMessage;
    const locale = (0, locale_1.resolveBriefLocale)(request.locale);
    const messageText = buildWorkReportSignalPacketTelegramDigest(request.packet);
    const chatId = trimOptionalString(request.chatId) ?? (0, telegram_client_1.getTelegramDefaultChatId)(env);
    const dryRun = request.dryRun ?? false;
    if (!dryRun && !chatId) {
        throw new Error("Telegram chat id is required when no TELEGRAM_DEFAULT_CHAT_ID is configured.");
    }
    const token = dryRun ? null : (0, telegram_client_1.getTelegramToken)(env);
    if (!dryRun && !token) {
        throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    }
    const execution = await (0, delivery_ledger_1.executeBriefDelivery)({
        channel: "telegram",
        provider: "telegram_bot_api",
        mode: "manual",
        scope: "work_report",
        projectId: request.packet.projectId,
        projectName: request.packet.projectName,
        locale,
        target: chatId ?? null,
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
            chatId: chatId ?? null,
            dryRun,
        },
        dryRun,
        idempotencyKey: request.idempotencyKey,
        env,
        execute: async () => {
            const sendResult = await sendMessage({
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
        },
    });
    return {
        reportId: request.packet.reportId,
        packetId: request.packet.packetId,
        locale,
        headline: buildDeliveryHeadline(request.packet),
        delivered: !dryRun,
        dryRun,
        chatId: chatId ? String(chatId) : null,
        messageText,
        ...(execution.providerMessageId ? { messageId: Number(execution.providerMessageId) } : {}),
        replayed: execution.replayed,
        ledger: execution.ledger,
    };
}
