"use strict";
/**
 * Agent Heartbeat → Telegram notification bridge
 *
 * Sends formatted heartbeat run results to a Telegram chat.
 * Uses Telegram Bot API directly (no grammY dependency needed).
 *
 * Configure via:
 *   - TELEGRAM_BOT_TOKEN env var
 *   - Agent.runtimeConfig.telegramChatId for per-agent delivery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendHeartbeatTelegramNotification = sendHeartbeatTelegramNotification;
exports.sendBudgetWarningTelegram = sendBudgetWarningTelegram;
const TELEGRAM_API = "https://api.telegram.org";
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const sec = Math.round(ms / 1000);
    if (sec < 60)
        return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
function buildMessage(n) {
    const icon = n.status === "succeeded" ? "✅" : n.status === "failed" ? "❌" : "⏰";
    const statusRu = n.status === "succeeded" ? "Успешно" : n.status === "failed" ? "Ошибка" : "Таймаут";
    let msg = `${icon} <b>${escapeHtml(n.agentName)}</b> — ${statusRu}\n`;
    msg += `⏱ ${formatDuration(n.durationMs)} · 🪙 ${n.tokenCount} tokens · 💰 $${(n.costCents / 100).toFixed(3)}\n`;
    if (n.summary) {
        const trimmed = n.summary.length > 500 ? n.summary.slice(0, 497) + "…" : n.summary;
        msg += `\n📝 ${escapeHtml(trimmed)}`;
    }
    if (n.errorMessage) {
        const trimmed = n.errorMessage.length > 300 ? n.errorMessage.slice(0, 297) + "…" : n.errorMessage;
        msg += `\n\n⚠️ <code>${escapeHtml(trimmed)}</code>`;
    }
    return msg;
}
function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/**
 * Send heartbeat result notification to Telegram
 */
async function sendHeartbeatTelegramNotification(chatId, notification) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn("[TelegramNotify] TELEGRAM_BOT_TOKEN not set, skipping");
        return false;
    }
    const text = buildMessage(notification);
    try {
        const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            console.error("[TelegramNotify] API error:", res.status, err);
            return false;
        }
        return true;
    }
    catch (error) {
        console.error("[TelegramNotify] Send failed:", error);
        return false;
    }
}
/**
 * Send budget warning to Telegram
 */
async function sendBudgetWarningTelegram(chatId, agentName, spentCents, budgetCents) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token)
        return false;
    const pct = Math.round((spentCents / budgetCents) * 100);
    const text = `⚠️ <b>Предупреждение о бюджете</b>\n` +
        `Агент <b>${escapeHtml(agentName)}</b> использовал ${pct}% месячного бюджета\n` +
        `💰 $${(spentCents / 100).toFixed(2)} / $${(budgetCents / 100).toFixed(2)}`;
    try {
        const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "HTML",
            }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
