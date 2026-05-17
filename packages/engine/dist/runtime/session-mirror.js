/**
 * Session mirror — shared Telegram ↔ IDE chat thread.
 *
 * Emits `session:message` for IDE subscribers and mirrors assistant replies
 * from the web channel back to Telegram when configured.
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
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
export function getTelegramMirrorSettings(config) {
    var _a;
    const tg = config.telegram;
    const linkedSessionId = ((_a = tg.linkedSessionId) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
    const ownerRaw = tg.ownerChatId;
    const ownerChatId = ownerRaw !== undefined && ownerRaw !== null && String(ownerRaw).length > 0
        ? String(ownerRaw)
        : undefined;
    return {
        enabled: Boolean(tg.enabled && tg.botToken && linkedSessionId),
        linkedSessionId,
        ownerChatId,
    };
}
function mirrorKey(sessionId, role, content) {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return `${sessionId}:${role}:${hash}`;
}
export class SessionMirror extends EventEmitter {
    constructor() {
        super(...arguments);
        this.recentKeys = new Set();
        this.keyQueue = [];
        this.maxKeys = 200;
    }
    rememberKey(key) {
        if (this.recentKeys.has(key))
            return false;
        this.recentKeys.add(key);
        this.keyQueue.push(key);
        while (this.keyQueue.length > this.maxKeys) {
            const old = this.keyQueue.shift();
            if (old)
                this.recentKeys.delete(old);
        }
        return true;
    }
    emitMessage(event) {
        const key = mirrorKey(event.sessionId, event.role, event.content);
        if (!this.rememberKey(key))
            return;
        this.emit('session:message', event);
    }
    mirrorAssistantToTelegram(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const { settings, sessionId, content, source, bot } = input;
            if (!settings.enabled || !settings.ownerChatId || !bot)
                return;
            if (source !== 'web')
                return;
            if (!settings.linkedSessionId || sessionId !== settings.linkedSessionId)
                return;
            const trimmed = content.trim();
            if (!trimmed)
                return;
            const key = mirrorKey(sessionId, 'assistant:mirror-tg', trimmed);
            if (!this.rememberKey(key))
                return;
            try {
                yield bot.sendMessage(settings.ownerChatId, trimmed);
            }
            catch (_a) {
                // Plain text fallback is handled by TelegramSender adapter in cli.ts
                yield bot.sendMessage(settings.ownerChatId, trimmed, undefined);
            }
        });
    }
}
export const sessionMirror = new SessionMirror();
