import { logger } from '../../observability/logger';

export class LiveActivity {
  private bot: { api: { sendMessage: Function; editMessageText: Function; deleteMessage: Function } };
  private chatId: number;
  private minIntervalMs: number;
  private maxLength: number;
  private messageId: number | null = null;
  private currentText: string = '';
  private lastUpdateAt: number = 0;
  private pendingText: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bot: any, chatId: number, opts?: { minIntervalMs?: number; maxLength?: number }) {
    this.bot = bot;
    this.chatId = chatId;
    this.minIntervalMs = opts?.minIntervalMs ?? 2000;
    this.maxLength = opts?.maxLength ?? 4000;
  }

  async start(initialText: string): Promise<void> {
    this.currentText = initialText;
    try {
      const msg = await this.bot.api.sendMessage(this.chatId, initialText);
      this.messageId = msg.message_id;
    } catch (err) {
      logger.warn('[LiveActivity] Failed to send start message', { error: String(err) });
    }
  }

  async update(text: string): Promise<void> {
    if (this.messageId === null) return;
    const now = Date.now();
    if (now - this.lastUpdateAt >= this.minIntervalMs) {
      await this._flush(text);
    } else {
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
  }

  private async _flush(text: string): Promise<void> {
    if (this.messageId === null) return;
    if (text === this.currentText) return;
    this.currentText = text;
    this.lastUpdateAt = Date.now();
    try {
      await this.bot.api.editMessageText(this.chatId, this.messageId, text);
    } catch (err) {
      const errStr = String(err);
      if (!errStr.includes('message is not modified')) {
        logger.warn('[LiveActivity] editMessageText failed', { error: errStr });
      }
    }
  }

  async append(line: string): Promise<void> {
    let newText = this.currentText ? `${this.currentText}\n${line}` : line;
    if (newText.length > this.maxLength) {
      const marker = '\n…\n[truncated]';
      newText = newText.slice(0, this.maxLength - marker.length) + marker;
    }
    await this.update(newText);
  }

  async complete(finalText: string, deleteAfterMs: number = 300_000): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingText = null;
    await this._flush(finalText);
    if (deleteAfterMs > 0 && this.messageId !== null) {
      const mid = this.messageId;
      setTimeout(() => {
        void this.bot.api.deleteMessage(this.chatId, mid).catch((e: unknown) => {
          logger.warn('[LiveActivity] deleteMessage failed', { error: String(e) });
        });
      }, deleteAfterMs);
    }
  }
}
