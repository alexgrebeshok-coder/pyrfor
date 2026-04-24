type TelegramFetch = typeof fetch;
export interface TelegramBotProfile {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
}
export interface TelegramWebhookInfo {
    url: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    ip_address?: string;
}
export interface TelegramSentMessage {
    message_id: number;
    date?: number;
}
export declare function getTelegramToken(env?: NodeJS.ProcessEnv): string | null;
export declare function getTelegramDefaultChatId(env?: NodeJS.ProcessEnv): string | null;
export declare function probeTelegramMethod<T>(token: string, method: "getMe" | "getWebhookInfo", fetchImpl?: TelegramFetch): Promise<{
    ok: true;
    result: T;
} | {
    ok: false;
    message: string;
}>;
export declare function sendTelegramTextMessage(input: {
    token: string;
    chatId: string | number;
    text: string;
    parseMode?: "Markdown" | "HTML";
}, fetchImpl?: TelegramFetch): Promise<{
    ok: true;
    result: TelegramSentMessage;
} | {
    ok: false;
    message: string;
    status?: number;
}>;
export {};
//# sourceMappingURL=telegram-client.d.ts.map