"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverBriefToTelegram = deliverBriefToTelegram;
const generate_1 = require("./generate");
const delivery_ledger_1 = require("./delivery-ledger");
const locale_1 = require("./locale");
const telegram_client_1 = require("../connectors/telegram-client");
async function deliverBriefToTelegram(request, deps = {}) {
    const env = deps.env ?? process.env;
    const locale = (0, locale_1.resolveBriefLocale)(request.locale);
    const generatePortfolio = deps.generatePortfolio ?? generate_1.generatePortfolioBrief;
    const generateProject = deps.generateProject ?? generate_1.generateProjectBrief;
    const sendMessage = deps.sendMessage ?? telegram_client_1.sendTelegramTextMessage;
    if (request.scope === "project" && !request.projectId) {
        throw new Error("projectId is required for project brief delivery.");
    }
    const brief = request.scope === "portfolio"
        ? await generatePortfolio({ locale })
        : await generateProject(request.projectId, { locale });
    const messageText = brief.formats.telegramDigest;
    const chatId = request.chatId?.trim() || (0, telegram_client_1.getTelegramDefaultChatId)(env);
    const projectName = "project" in brief ? brief.project.name : null;
    if (!request.dryRun && !chatId) {
        throw new Error("Telegram chat id is required when no TELEGRAM_DEFAULT_CHAT_ID is configured.");
    }
    const token = request.dryRun ? null : (0, telegram_client_1.getTelegramToken)(env);
    if (!request.dryRun && !token) {
        throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    }
    const execution = await (0, delivery_ledger_1.executeBriefDelivery)({
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
