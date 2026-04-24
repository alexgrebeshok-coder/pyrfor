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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
export function sendHeartbeatTelegramNotification(chatId, notification) {
    return __awaiter(this, void 0, void 0, function* () {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            console.warn("[TelegramNotify] TELEGRAM_BOT_TOKEN not set, skipping");
            return false;
        }
        const text = buildMessage(notification);
        try {
            const res = yield fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
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
                const err = yield res.text();
                console.error("[TelegramNotify] API error:", res.status, err);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error("[TelegramNotify] Send failed:", error);
            return false;
        }
    });
}
/**
 * Send budget warning to Telegram
 */
export function sendBudgetWarningTelegram(chatId, agentName, spentCents, budgetCents) {
    return __awaiter(this, void 0, void 0, function* () {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token)
            return false;
        const pct = Math.round((spentCents / budgetCents) * 100);
        const text = `⚠️ <b>Предупреждение о бюджете</b>\n` +
            `Агент <b>${escapeHtml(agentName)}</b> использовал ${pct}% месячного бюджета\n` +
            `💰 $${(spentCents / 100).toFixed(2)} / $${(budgetCents / 100).toFixed(2)}`;
        try {
            const res = yield fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
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
        catch (_a) {
            return false;
        }
    });
}
