var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { probeTelegramMethod, } from '../telegram-client';
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
export function createTelegramConnector(env = process.env, fetchImpl) {
    return Object.assign(Object.assign({}, descriptor), { getStatus() {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                const checkedAt = new Date().toISOString();
                const token = (_a = env.TELEGRAM_BOT_TOKEN) === null || _a === void 0 ? void 0 : _a.trim();
                if (!token) {
                    return Object.assign(Object.assign({}, descriptor), { status: "pending", configured: false, checkedAt, missingSecrets: ["TELEGRAM_BOT_TOKEN"], message: "Telegram live probe is waiting for TELEGRAM_BOT_TOKEN." });
                }
                try {
                    const probeFetch = fetchImpl !== null && fetchImpl !== void 0 ? fetchImpl : fetch;
                    const [botProfileResult, webhookInfoResult] = yield Promise.all([
                        probeTelegramMethod(token, "getMe", probeFetch),
                        probeTelegramMethod(token, "getWebhookInfo", probeFetch),
                    ]);
                    if (!botProfileResult.ok) {
                        return Object.assign(Object.assign({}, descriptor), { status: "degraded", configured: true, checkedAt, missingSecrets: [], message: `Telegram bot probe failed: ${botProfileResult.message}` });
                    }
                    if (!webhookInfoResult.ok) {
                        return Object.assign(Object.assign({}, descriptor), { status: "degraded", configured: true, checkedAt, missingSecrets: [], message: `Telegram bot is reachable, but webhook probe failed: ${webhookInfoResult.message}`, metadata: {
                                botId: botProfileResult.result.id,
                                botUsername: (_b = botProfileResult.result.username) !== null && _b !== void 0 ? _b : null,
                            } });
                    }
                    const webhookUrl = ((_c = webhookInfoResult.result.url) === null || _c === void 0 ? void 0 : _c.trim()) || null;
                    const pendingUpdateCount = (_d = webhookInfoResult.result.pending_update_count) !== null && _d !== void 0 ? _d : 0;
                    const lastErrorMessage = ((_e = webhookInfoResult.result.last_error_message) === null || _e === void 0 ? void 0 : _e.trim()) || null;
                    const webhookConfigured = Boolean(webhookUrl);
                    const degradedReason = !webhookConfigured
                        ? "webhook is not configured"
                        : lastErrorMessage
                            ? `webhook error: ${lastErrorMessage}`
                            : pendingUpdateCount > 0
                                ? `${pendingUpdateCount} pending Telegram updates`
                                : null;
                    return Object.assign(Object.assign({}, descriptor), { status: degradedReason ? "degraded" : "ok", configured: true, checkedAt, missingSecrets: [], message: degradedReason
                            ? `Telegram bot @${(_f = botProfileResult.result.username) !== null && _f !== void 0 ? _f : botProfileResult.result.id} is reachable, but ${degradedReason}.`
                            : `Telegram bot @${(_g = botProfileResult.result.username) !== null && _g !== void 0 ? _g : botProfileResult.result.id} is reachable and webhook is configured.`, metadata: {
                            botId: botProfileResult.result.id,
                            botUsername: (_h = botProfileResult.result.username) !== null && _h !== void 0 ? _h : null,
                            canJoinGroups: (_j = botProfileResult.result.can_join_groups) !== null && _j !== void 0 ? _j : null,
                            supportsInlineQueries: (_k = botProfileResult.result.supports_inline_queries) !== null && _k !== void 0 ? _k : null,
                            webhookConfigured,
                            webhookUrl,
                            pendingUpdateCount,
                            lastErrorMessage,
                            hasCustomCertificate: (_l = webhookInfoResult.result.has_custom_certificate) !== null && _l !== void 0 ? _l : null,
                        } });
                }
                catch (error) {
                    return Object.assign(Object.assign({}, descriptor), { status: "degraded", configured: true, checkedAt, missingSecrets: [], message: error instanceof Error
                            ? `Telegram probe failed: ${error.message}`
                            : "Telegram probe failed with an unknown error." });
                }
            });
        } });
}
