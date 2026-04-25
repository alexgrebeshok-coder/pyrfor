/**
 * Bot commands metadata helper — manages setMyCommands payloads for Pyrfor.
 */
export interface BotCommandSpec {
    command: string;
    description: string;
    scope?: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators';
}
export interface SetMyCommandsApi {
    setMyCommands(commands: Array<{
        command: string;
        description: string;
    }>, opts?: {
        scope?: {
            type: string;
        };
        language_code?: string;
    }): Promise<unknown>;
}
export declare const PYRFOR_COMMANDS: BotCommandSpec[];
export declare function publishBotCommands(api: SetMyCommandsApi, commands?: BotCommandSpec[], opts?: {
    languageCode?: string;
}): Promise<{
    scopesApplied: number;
    total: number;
}>;
//# sourceMappingURL=bot-commands-meta.d.ts.map