"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTelegramToken = getTelegramToken;
exports.getTelegramDefaultChatId = getTelegramDefaultChatId;
exports.probeTelegramMethod = probeTelegramMethod;
exports.sendTelegramTextMessage = sendTelegramTextMessage;
function getTelegramToken(env = process.env) {
    return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}
function getTelegramDefaultChatId(env = process.env) {
    return env.TELEGRAM_DEFAULT_CHAT_ID?.trim() || null;
}
async function probeTelegramMethod(token, method, fetchImpl = fetch) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
        cache: "no-store",
    });
    if (!response.ok) {
        return {
            ok: false,
            message: `HTTP ${response.status} while calling ${method}`,
        };
    }
    const payload = (await response.json());
    if (!payload.ok) {
        return {
            ok: false,
            message: payload.description || `Telegram API rejected ${method}`,
        };
    }
    return {
        ok: true,
        result: payload.result,
    };
}
async function sendTelegramTextMessage(input, fetchImpl = fetch) {
    const response = await fetchImpl(`https://api.telegram.org/bot${input.token}/sendMessage`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
            ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
        }),
    });
    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            message: `HTTP ${response.status} while calling sendMessage`,
        };
    }
    const payload = (await response.json());
    if (!payload.ok) {
        return {
            ok: false,
            status: payload.error_code,
            message: payload.description || "Telegram API rejected sendMessage",
        };
    }
    return {
        ok: true,
        result: payload.result,
    };
}
