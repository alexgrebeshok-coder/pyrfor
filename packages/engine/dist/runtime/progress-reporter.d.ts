/**
 * TG progress reporter — reusable "no silent waiting" helper.
 *
 * Streams status messages to a Telegram chat with edit-message debouncing
 * and graceful failure so pipeline errors never surface to the user.
 */
/**
 * Minimal subset of grammY ChatApi we depend on. Tests can mock this trivially;
 * cli.ts will pass `bot.api` (compatible-shaped) at runtime.
 */
export interface ChatProgressApi {
    sendMessage(chatId: number | string, text: string, opts?: {
        parse_mode?: string;
        reply_to_message_id?: number;
    }): Promise<{
        message_id: number;
    }>;
    editMessageText(chatId: number | string, messageId: number, text: string, opts?: {
        parse_mode?: string;
    }): Promise<unknown>;
    sendChatAction(chatId: number | string, action: 'typing' | 'upload_document' | 'upload_photo'): Promise<unknown>;
    deleteMessage?(chatId: number | string, messageId: number): Promise<unknown>;
}
export interface ProgressReporterOptions {
    api: ChatProgressApi;
    chatId: number | string;
    /** Optional reply-to message id for the initial sendMessage. */
    replyTo?: number;
    /** Min ms between editMessageText calls. Default 1500. */
    editDebounceMs?: number;
    /** Auto-typing-action interval (set to 0 to disable). Default 4000. */
    typingIntervalMs?: number;
    /** Max characters for any single message; truncated with "…" suffix. Default 3500. */
    maxLength?: number;
    /** Optional logger. */
    log?: (msg: string, meta?: Record<string, unknown>) => void;
    /** Inject Date.now for tests. */
    now?: () => number;
}
export interface ProgressReporter {
    /** Send the initial status message. Idempotent: subsequent calls are ignored. */
    start(initialText: string): Promise<void>;
    /** Edit the existing message (debounced). If start() not called yet, calls it. */
    update(text: string): Promise<void>;
    /** Final message text. Cancels pending debounced updates. Stops typing. */
    finish(finalText: string, opts?: {
        parseMode?: string;
    }): Promise<void>;
    /** Mark as error; keeps message visible with ❌ prefix. */
    fail(reason: string): Promise<void>;
    /** Cancel without sending finish. Stops typing. */
    cancel(): Promise<void>;
    /** Status accessors for tests/inspection. */
    readonly messageId: number | undefined;
    readonly state: 'idle' | 'sent' | 'finished' | 'failed' | 'cancelled';
}
export declare function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter;
//# sourceMappingURL=progress-reporter.d.ts.map