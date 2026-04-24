var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { generatePortfolioBrief, generateProjectBrief } from './generate';
import { executeBriefDelivery, } from './delivery-ledger';
import { resolveBriefLocale } from './locale';
import { getTelegramDefaultChatId, getTelegramToken, sendTelegramTextMessage, } from '../connectors/telegram-client';
export function deliverBriefToTelegram(request_1) {
    return __awaiter(this, arguments, void 0, function* (request, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const env = (_a = deps.env) !== null && _a !== void 0 ? _a : process.env;
        const locale = resolveBriefLocale(request.locale);
        const generatePortfolio = (_b = deps.generatePortfolio) !== null && _b !== void 0 ? _b : generatePortfolioBrief;
        const generateProject = (_c = deps.generateProject) !== null && _c !== void 0 ? _c : generateProjectBrief;
        const sendMessage = (_d = deps.sendMessage) !== null && _d !== void 0 ? _d : sendTelegramTextMessage;
        if (request.scope === "project" && !request.projectId) {
            throw new Error("projectId is required for project brief delivery.");
        }
        const brief = request.scope === "portfolio"
            ? yield generatePortfolio({ locale })
            : yield generateProject(request.projectId, { locale });
        const messageText = brief.formats.telegramDigest;
        const chatId = ((_e = request.chatId) === null || _e === void 0 ? void 0 : _e.trim()) || getTelegramDefaultChatId(env);
        const projectName = "project" in brief ? brief.project.name : null;
        if (!request.dryRun && !chatId) {
            throw new Error("Telegram chat id is required when no TELEGRAM_DEFAULT_CHAT_ID is configured.");
        }
        const token = request.dryRun ? null : getTelegramToken(env);
        if (!request.dryRun && !token) {
            throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
        }
        const execution = yield executeBriefDelivery({
            channel: "telegram",
            provider: "telegram_bot_api",
            mode: request.scheduledPolicyId ? "scheduled" : "manual",
            scope: request.scope,
            projectId: request.projectId,
            projectName,
            locale,
            target: chatId !== null && chatId !== void 0 ? chatId : null,
            headline: brief.headline,
            content: {
                messageText,
            },
            requestPayload: {
                scope: request.scope,
                projectId: (_f = request.projectId) !== null && _f !== void 0 ? _f : null,
                locale,
                chatId: chatId !== null && chatId !== void 0 ? chatId : null,
                dryRun: (_g = request.dryRun) !== null && _g !== void 0 ? _g : false,
            },
            dryRun: request.dryRun,
            idempotencyKey: request.idempotencyKey,
            scheduledPolicyId: request.scheduledPolicyId,
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
        return Object.assign(Object.assign({ scope: request.scope, locale, chatId: chatId ? String(chatId) : null, headline: brief.headline, delivered: !request.dryRun, dryRun: (_h = request.dryRun) !== null && _h !== void 0 ? _h : false, messageText }, (execution.providerMessageId ? { messageId: Number(execution.providerMessageId) } : {})), { replayed: execution.replayed, ledger: execution.ledger });
    });
}
