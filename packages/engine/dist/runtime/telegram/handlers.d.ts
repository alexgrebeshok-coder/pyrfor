/**
 * Pyrfor Runtime — Telegram PM Command Handlers
 *
 * Standalone module containing pure business-logic for Telegram PM commands.
 * No grammy / bot wiring here — orchestrator (cli.ts) wires the bot adapter.
 *
 * Prisma is injected via setTelegramPrismaClient to avoid @prisma/client dep.
 * runMessage for /ai is injected at call-site by orchestrator.
 */
/** Unified args shape for every PM command handler. */
export interface CommandArgs {
    chatId: number;
    text: string;
    /** Whitespace-split tokens from the message body (after command prefix). */
    params: string[];
}
export interface OchagReminderDraft {
    title: string;
    familyId?: string;
    dueAt?: string;
    visibility?: 'member' | 'family';
    audience?: string;
    privacy?: string;
}
export declare function setTelegramPrismaClient(client: any): void;
export declare function getTelegramPrismaClient(): any;
/**
 * Returns true when chatId is allowed.
 * Empty allowedChatIds = open mode (everyone allowed).
 */
export declare function isAllowedChat(chatId: number, allowedChatIds: number[]): boolean;
export declare function parseOchagReminderParams(params: string[]): OchagReminderDraft;
export declare function handleOchagReminderPreview(args: CommandArgs, draft?: OchagReminderDraft): string;
export declare function handleOchagPrivacy(): string;
/**
 * In-memory sliding-window rate limiter, per chatId.
 * Keeps the last `perMinute` timestamps per chat in a 60-second window.
 */
export declare function createRateLimiter(perMinute: number): {
    allow(chatId: number): boolean;
};
/** Escape MarkdownV2 special characters for Telegram.
 *  Null/undefined input is coerced to empty string (defensive: DB fields may be nullable at runtime). */
export declare function escapeMarkdown(text: string): string;
export declare function handleStatus({ chatId }: CommandArgs): Promise<string>;
export declare function handleProjects({ chatId }: CommandArgs): Promise<string>;
export declare function handleTasks({ chatId }: CommandArgs): Promise<string>;
export declare function handleAddTask({ chatId, params }: CommandArgs): Promise<string>;
/**
 * /ai handler — delegates to `runMessage` injected by orchestrator.
 * If runMessage is not provided, returns a stub message (orchestrator must wire it).
 */
export declare function handleAi({ chatId, params }: CommandArgs, runMessage?: (text: string) => Promise<string>): Promise<string>;
export declare function handleMorningBrief({ chatId }: CommandArgs): Promise<string>;
//# sourceMappingURL=handlers.d.ts.map