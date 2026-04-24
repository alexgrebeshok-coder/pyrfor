/**
 * Budget-alert webhook subscriber.
 *
 * Subscribes to `budget.alert` events on the agent bus and forwards them
 * to a Slack-compatible incoming webhook when `BUDGET_ALERT_WEBHOOK_URL`
 * is configured. The payload shape is compatible with Slack, Mattermost,
 * and Discord's Slack-compat endpoint (`.../slack`).
 *
 * Called once per Node process from `instrumentation.ts#register`. Safe
 * to call multiple times — the subscription is de-duplicated via a
 * module-level flag.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "server-only";
import { logger } from '../../observability/logger';
import { agentBus } from './agent-bus';
const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_MAX_ATTEMPTS = 2;
let initialized = false;
let unsubscribe = null;
const deliveryLog = [];
const MAX_DELIVERY_LOG = 50;
function recordDelivery(delivery) {
    deliveryLog.push(delivery);
    if (deliveryLog.length > MAX_DELIVERY_LOG) {
        deliveryLog.shift();
    }
}
export function getRecentBudgetWebhookDeliveries(limit = 20) {
    return deliveryLog.slice(-limit).reverse();
}
function severityEmoji(severity) {
    return severity === "breach" ? ":rotating_light:" : ":warning:";
}
function severityColor(severity) {
    return severity === "breach" ? "#d9534f" : "#f0ad4e";
}
/**
 * Infer the webhook format from the URL host. Can be forced via
 * `BUDGET_ALERT_WEBHOOK_FORMAT={slack|telegram|teams}`.
 */
export function detectWebhookFormat(url) {
    var _a;
    const forced = (_a = process.env.BUDGET_ALERT_WEBHOOK_FORMAT) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (forced === "slack" || forced === "telegram" || forced === "teams") {
        return forced;
    }
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.includes("api.telegram.org") || host.endsWith("t.me")) {
            return "telegram";
        }
        if (host.endsWith("webhook.office.com") ||
            host.endsWith("office.com") ||
            host.includes("outlook.office") ||
            host.includes("teams.microsoft")) {
            return "teams";
        }
    }
    catch (_b) {
        // ignore
    }
    return "slack";
}
function formatTelegramPayload(payload, chatIdOverride) {
    const pct = (payload.utilization * 100).toFixed(1);
    const trig = payload.triggeredBy;
    const emoji = payload.severity === "breach" ? "🚨" : "⚠️";
    const title = payload.severity === "breach"
        ? `${emoji} *AI budget breach* in \`${payload.workspaceId}\``
        : `${emoji} *AI budget warning* in \`${payload.workspaceId}\``;
    const lines = [
        title,
        `💰 *$${payload.totalUsdToday.toFixed(4)}* / $${payload.dailyLimitUsd.toFixed(2)} (${pct}%)`,
        `📊 Threshold: ${(payload.threshold * 100).toFixed(0)}%`,
        `🧠 ${trig.provider} / ${trig.model}`,
        trig.agentId ? `🤖 Agent: \`${trig.agentId}\`` : null,
        trig.runId ? `🔗 Run: \`${trig.runId}\`` : null,
        `💸 This call: $${trig.costUsd.toFixed(4)}`,
    ].filter(Boolean);
    const chatId = chatIdOverride !== null && chatIdOverride !== void 0 ? chatIdOverride : process.env.BUDGET_ALERT_TELEGRAM_CHAT_ID;
    const out = {
        text: lines.join("\n"),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
    };
    if (chatId) {
        out.chat_id = chatId;
    }
    return out;
}
function formatTeamsPayload(payload) {
    var _a, _b;
    const pct = (payload.utilization * 100).toFixed(1);
    const trig = payload.triggeredBy;
    const title = payload.severity === "breach"
        ? `AI budget breach · ${payload.workspaceId}`
        : `AI budget warning · ${payload.workspaceId}`;
    const themeColor = payload.severity === "breach" ? "D9534F" : "F0AD4E";
    return {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: title,
        themeColor,
        title,
        text: `**$${payload.totalUsdToday.toFixed(4)}** of $${payload.dailyLimitUsd.toFixed(2)} used today (${pct}%).`,
        sections: [
            {
                facts: [
                    { name: "Workspace", value: payload.workspaceId },
                    { name: "Severity", value: payload.severity },
                    { name: "Threshold", value: `${(payload.threshold * 100).toFixed(0)}%` },
                    { name: "Utilisation", value: `${pct}%` },
                    { name: "Spent today", value: `$${payload.totalUsdToday.toFixed(4)}` },
                    { name: "Daily limit", value: `$${payload.dailyLimitUsd.toFixed(2)}` },
                    { name: "Provider / model", value: `${trig.provider} / ${trig.model}` },
                    { name: "Run", value: (_a = trig.runId) !== null && _a !== void 0 ? _a : "—" },
                    { name: "Agent", value: (_b = trig.agentId) !== null && _b !== void 0 ? _b : "—" },
                    { name: "This call", value: `$${trig.costUsd.toFixed(4)}` },
                ],
            },
        ],
    };
}
function formatSlackPayload(payload) {
    var _a, _b;
    const pct = (payload.utilization * 100).toFixed(1);
    const trig = payload.triggeredBy;
    const header = payload.severity === "breach"
        ? `${severityEmoji(payload.severity)} AI budget breach in workspace \`${payload.workspaceId}\``
        : `${severityEmoji(payload.severity)} AI budget warning in workspace \`${payload.workspaceId}\``;
    const text = `${header}\n$${payload.totalUsdToday.toFixed(4)} / $${payload.dailyLimitUsd.toFixed(2)} used today (${pct}%). Triggered by ${trig.provider}/${trig.model} on agent \`${(_a = trig.agentId) !== null && _a !== void 0 ? _a : "?"}\` (+$${trig.costUsd.toFixed(4)}).`;
    return {
        text,
        attachments: [
            {
                color: severityColor(payload.severity),
                fields: [
                    { title: "Workspace", value: payload.workspaceId, short: true },
                    { title: "Severity", value: payload.severity, short: true },
                    {
                        title: "Threshold",
                        value: `${(payload.threshold * 100).toFixed(0)}%`,
                        short: true,
                    },
                    {
                        title: "Utilisation",
                        value: `${pct}%`,
                        short: true,
                    },
                    {
                        title: "Spent today",
                        value: `$${payload.totalUsdToday.toFixed(4)}`,
                        short: true,
                    },
                    {
                        title: "Daily limit",
                        value: `$${payload.dailyLimitUsd.toFixed(2)}`,
                        short: true,
                    },
                    {
                        title: "Provider / model",
                        value: `${trig.provider} / ${trig.model}`,
                        short: true,
                    },
                    {
                        title: "Run",
                        value: (_b = trig.runId) !== null && _b !== void 0 ? _b : "—",
                        short: true,
                    },
                ],
                footer: "CEOClaw cost-tracker",
                ts: Math.floor(new Date(payload.at).getTime() / 1000),
            },
        ],
    };
}
function postWebhook(url, body, signal) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
        });
        if (!response.ok) {
            const errorText = yield response.text().catch(() => "");
            return { status: response.status, ok: false, errorText };
        }
        return { status: response.status, ok: true };
    });
}
function formatPayloadForUrl(payload, url) {
    const format = detectWebhookFormat(url);
    if (format === "telegram") {
        return { body: formatTelegramPayload(payload), format };
    }
    if (format === "teams") {
        return { body: formatTeamsPayload(payload), format };
    }
    return { body: formatSlackPayload(payload), format };
}
/**
 * Deliver a single budget alert to the configured webhook. The exact
 * payload shape depends on the target host (Slack / Telegram / Teams);
 * see `detectWebhookFormat`. Exported so tests can exercise the HTTP
 * path without going through the agent bus.
 */
export function deliverBudgetAlertToWebhook(payload, overrideUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const url = overrideUrl !== null && overrideUrl !== void 0 ? overrideUrl : process.env.BUDGET_ALERT_WEBHOOK_URL;
        if (!url) {
            const delivery = {
                url: "",
                format: "slack",
                status: 0,
                ok: false,
                attempts: 0,
                error: "BUDGET_ALERT_WEBHOOK_URL not set",
            };
            recordDelivery(delivery);
            return delivery;
        }
        const { body, format } = formatPayloadForUrl(payload, url);
        let lastError;
        let lastStatus = 0;
        for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
            try {
                const result = yield postWebhook(url, body, controller.signal);
                lastStatus = result.status;
                if (result.ok) {
                    const delivery = {
                        url,
                        format,
                        status: result.status,
                        ok: true,
                        attempts: attempt,
                    };
                    recordDelivery(delivery);
                    return delivery;
                }
                lastError = `HTTP ${result.status}: ${((_a = result.errorText) !== null && _a !== void 0 ? _a : "").slice(0, 200)}`;
                // Retry only on 5xx / 429.
                if (!(result.status === 429 || (result.status >= 500 && result.status <= 599))) {
                    break;
                }
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }
            finally {
                clearTimeout(timer);
            }
            if (attempt < WEBHOOK_MAX_ATTEMPTS) {
                yield new Promise((r) => setTimeout(r, 250 * attempt));
            }
        }
        const delivery = {
            url,
            format,
            status: lastStatus,
            ok: false,
            attempts: WEBHOOK_MAX_ATTEMPTS,
            error: lastError,
        };
        recordDelivery(delivery);
        logger.warn("budget-webhook: delivery failed", {
            url: url.slice(0, 64),
            status: lastStatus,
            error: lastError,
            severity: payload.severity,
            workspaceId: payload.workspaceId,
        });
        return delivery;
    });
}
/**
 * Subscribe to budget.alert events and deliver each one to the configured
 * Slack-compatible webhook. Idempotent.
 */
export function initBudgetAlertWebhook() {
    if (initialized)
        return;
    if (!process.env.BUDGET_ALERT_WEBHOOK_URL) {
        logger.info("budget-webhook: disabled (BUDGET_ALERT_WEBHOOK_URL not set)");
        initialized = true;
        return;
    }
    const subscription = agentBus.subscribe("budget.alert", (message) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield deliverBudgetAlertToWebhook(message.payload);
        }
        catch (err) {
            logger.warn("budget-webhook: handler threw", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }));
    unsubscribe = subscription.unsubscribe;
    initialized = true;
    logger.info("budget-webhook: subscribed to budget.alert events");
}
/**
 * Internal helper — clears subscription state so tests can re-initialise.
 * @internal
 */
export function __resetBudgetWebhookForTests() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    initialized = false;
    deliveryLog.length = 0;
}
