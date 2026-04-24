/**
 * Telegram abstraction — minimal API used by runtime/tools.
 *
 * Allows runtime to depend on a thin interface instead of a concrete library
 * (node-telegram-bot-api / grammY). The CLI wires a concrete adapter at startup.
 */

export interface TelegramSendOptions {
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
}

export interface TelegramSender {
  sendMessage(
    chatId: string | number,
    text: string,
    options?: TelegramSendOptions
  ): Promise<unknown>;
}
