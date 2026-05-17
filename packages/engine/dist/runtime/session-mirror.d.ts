/**
 * Session mirror — shared Telegram ↔ IDE chat thread.
 *
 * Emits `session:message` for IDE subscribers and mirrors assistant replies
 * from the web channel back to Telegram when configured.
 */
import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from './config';
import type { TelegramSender } from './telegram-types';
export type SessionMessageSource = 'web' | 'telegram';
export interface SessionMirrorEvent {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    source: SessionMessageSource;
    ts: number;
}
export interface TelegramMirrorSettings {
    enabled: boolean;
    linkedSessionId?: string;
    ownerChatId?: string;
}
export declare function getTelegramMirrorSettings(config: RuntimeConfig): TelegramMirrorSettings;
export declare class SessionMirror extends EventEmitter {
    private readonly recentKeys;
    private readonly keyQueue;
    private readonly maxKeys;
    private rememberKey;
    emitMessage(event: SessionMirrorEvent): void;
    mirrorAssistantToTelegram(input: {
        settings: TelegramMirrorSettings;
        sessionId: string;
        content: string;
        source: SessionMessageSource;
        bot: TelegramSender | null;
    }): Promise<void>;
}
export declare const sessionMirror: SessionMirror;
//# sourceMappingURL=session-mirror.d.ts.map