"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTelegramConnector = createTelegramConnector;
const telegram_client_1 = require("../telegram-client");
const descriptor = {
    id: "telegram",
    name: "Telegram",
    description: "Bridge for bot commands and outbound PMO notifications. Uses the existing webhook endpoint and now performs a live Bot API readiness probe.",
    direction: "bidirectional",
    sourceSystem: "Telegram Bot API",
    operations: [
        "Receive bot commands via webhook",
        "Verify bot identity and webhook readiness via Bot API",
        "Send chat replies and future alert digests",
    ],
    credentials: [
        {
            envVar: "TELEGRAM_BOT_TOKEN",
            description: "Bot token used by the existing webhook and outbound sendMessage calls.",
        },
    ],
    apiSurface: [
        {
            method: "WEBHOOK",
            path: "/api/telegram/webhook",
            description: "Existing Telegram webhook for inbound updates.",
        },
        {
            method: "GET",
            path: "/api/connectors/telegram",
            description: "Connector status for the Telegram bridge.",
        },
    ],
    stub: false,
};
function createTelegramConnector(env = process.env, fetchImpl) {
    return {
        ...descriptor,
        async getStatus() {
            const checkedAt = new Date().toISOString();
            const token = env.TELEGRAM_BOT_TOKEN?.trim();
            if (!token) {
                return {
                    ...descriptor,
                    status: "pending",
                    configured: false,
                    checkedAt,
                    missingSecrets: ["TELEGRAM_BOT_TOKEN"],
                    message: "Telegram live probe is waiting for TELEGRAM_BOT_TOKEN.",
                };
            }
            try {
                const probeFetch = fetchImpl ?? fetch;
                const [botProfileResult, webhookInfoResult] = await Promise.all([
                    (0, telegram_client_1.probeTelegramMethod)(token, "getMe", probeFetch),
                    (0, telegram_client_1.probeTelegramMethod)(token, "getWebhookInfo", probeFetch),
                ]);
                if (!botProfileResult.ok) {
                    return {
                        ...descriptor,
                        status: "degraded",
                        configured: true,
                        checkedAt,
                        missingSecrets: [],
                        message: `Telegram bot probe failed: ${botProfileResult.message}`,
                    };
                }
                if (!webhookInfoResult.ok) {
                    return {
                        ...descriptor,
                        status: "degraded",
                        configured: true,
                        checkedAt,
                        missingSecrets: [],
                        message: `Telegram bot is reachable, but webhook probe failed: ${webhookInfoResult.message}`,
                        metadata: {
                            botId: botProfileResult.result.id,
                            botUsername: botProfileResult.result.username ?? null,
                        },
                    };
                }
                const webhookUrl = webhookInfoResult.result.url?.trim() || null;
                const pendingUpdateCount = webhookInfoResult.result.pending_update_count ?? 0;
                const lastErrorMessage = webhookInfoResult.result.last_error_message?.trim() || null;
                const webhookConfigured = Boolean(webhookUrl);
                const degradedReason = !webhookConfigured
                    ? "webhook is not configured"
                    : lastErrorMessage
                        ? `webhook error: ${lastErrorMessage}`
                        : pendingUpdateCount > 0
                            ? `${pendingUpdateCount} pending Telegram updates`
                            : null;
                return {
                    ...descriptor,
                    status: degradedReason ? "degraded" : "ok",
                    configured: true,
                    checkedAt,
                    missingSecrets: [],
                    message: degradedReason
                        ? `Telegram bot @${botProfileResult.result.username ?? botProfileResult.result.id} is reachable, but ${degradedReason}.`
                        : `Telegram bot @${botProfileResult.result.username ?? botProfileResult.result.id} is reachable and webhook is configured.`,
                    metadata: {
                        botId: botProfileResult.result.id,
                        botUsername: botProfileResult.result.username ?? null,
                        canJoinGroups: botProfileResult.result.can_join_groups ?? null,
                        supportsInlineQueries: botProfileResult.result.supports_inline_queries ?? null,
                        webhookConfigured,
                        webhookUrl,
                        pendingUpdateCount,
                        lastErrorMessage,
                        hasCustomCertificate: webhookInfoResult.result.has_custom_certificate ?? null,
                    },
                };
            }
            catch (error) {
                return {
                    ...descriptor,
                    status: "degraded",
                    configured: true,
                    checkedAt,
                    missingSecrets: [],
                    message: error instanceof Error
                        ? `Telegram probe failed: ${error.message}`
                        : "Telegram probe failed with an unknown error.",
                };
            }
        },
    };
}
