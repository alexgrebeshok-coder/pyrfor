var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function getTelegramToken(env = process.env) {
    var _a;
    return ((_a = env.TELEGRAM_BOT_TOKEN) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getTelegramDefaultChatId(env = process.env) {
    var _a;
    return ((_a = env.TELEGRAM_DEFAULT_CHAT_ID) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function probeTelegramMethod(token_1, method_1) {
    return __awaiter(this, arguments, void 0, function* (token, method, fetchImpl = fetch) {
        const response = yield fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
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
        const payload = (yield response.json());
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
    });
}
export function sendTelegramTextMessage(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, fetchImpl = fetch) {
        const response = yield fetchImpl(`https://api.telegram.org/bot${input.token}/sendMessage`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(Object.assign({ chat_id: input.chatId, text: input.text }, (input.parseMode ? { parse_mode: input.parseMode } : {}))),
        });
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                message: `HTTP ${response.status} while calling sendMessage`,
            };
        }
        const payload = (yield response.json());
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
    });
}
