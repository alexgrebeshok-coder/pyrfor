var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../../observability/logger.js';
export class LiveActivity {
    constructor(bot, chatId, opts) {
        var _a, _b;
        this.messageId = null;
        this.currentText = '';
        this.lastUpdateAt = 0;
        this.pendingText = null;
        this.flushTimer = null;
        this.bot = bot;
        this.chatId = chatId;
        this.minIntervalMs = (_a = opts === null || opts === void 0 ? void 0 : opts.minIntervalMs) !== null && _a !== void 0 ? _a : 2000;
        this.maxLength = (_b = opts === null || opts === void 0 ? void 0 : opts.maxLength) !== null && _b !== void 0 ? _b : 4000;
    }
    start(initialText) {
        return __awaiter(this, void 0, void 0, function* () {
            this.currentText = initialText;
            try {
                const msg = yield this.bot.api.sendMessage(this.chatId, initialText);
                this.messageId = msg.message_id;
            }
            catch (err) {
                logger.warn('[LiveActivity] Failed to send start message', { error: String(err) });
            }
        });
    }
    update(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.messageId === null)
                return;
            const now = Date.now();
            if (now - this.lastUpdateAt >= this.minIntervalMs) {
                yield this._flush(text);
            }
            else {
                this.pendingText = text;
                if (!this.flushTimer) {
                    const delay = this.minIntervalMs - (now - this.lastUpdateAt);
                    this.flushTimer = setTimeout(() => {
                        this.flushTimer = null;
                        if (this.pendingText !== null) {
                            const t = this.pendingText;
                            this.pendingText = null;
                            void this._flush(t);
                        }
                    }, delay);
                }
            }
        });
    }
    _flush(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.messageId === null)
                return;
            if (text === this.currentText)
                return;
            this.currentText = text;
            this.lastUpdateAt = Date.now();
            try {
                yield this.bot.api.editMessageText(this.chatId, this.messageId, text);
            }
            catch (err) {
                const errStr = String(err);
                if (!errStr.includes('message is not modified')) {
                    logger.warn('[LiveActivity] editMessageText failed', { error: errStr });
                }
            }
        });
    }
    append(line) {
        return __awaiter(this, void 0, void 0, function* () {
            let newText = this.currentText ? `${this.currentText}\n${line}` : line;
            if (newText.length > this.maxLength) {
                const marker = '\n…\n[truncated]';
                newText = newText.slice(0, this.maxLength - marker.length) + marker;
            }
            yield this.update(newText);
        });
    }
    complete(finalText_1) {
        return __awaiter(this, arguments, void 0, function* (finalText, deleteAfterMs = 300000) {
            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
            this.pendingText = null;
            yield this._flush(finalText);
            if (deleteAfterMs > 0 && this.messageId !== null) {
                const mid = this.messageId;
                setTimeout(() => {
                    void this.bot.api.deleteMessage(this.chatId, mid).catch((e) => {
                        logger.warn('[LiveActivity] deleteMessage failed', { error: String(e) });
                    });
                }, deleteAfterMs);
            }
        });
    }
}
