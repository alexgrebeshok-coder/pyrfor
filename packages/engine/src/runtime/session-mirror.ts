/**
 * Session mirror — shared Telegram ↔ IDE chat thread.
 *
 * Emits `session:message` for IDE subscribers and mirrors assistant replies
 * from the web channel back to Telegram when configured.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
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

export function getTelegramMirrorSettings(config: RuntimeConfig): TelegramMirrorSettings {
  const tg = config.telegram;
  const linkedSessionId = tg.linkedSessionId?.trim() || undefined;
  const ownerRaw = tg.ownerChatId;
  const ownerChatId =
    ownerRaw !== undefined && ownerRaw !== null && String(ownerRaw).length > 0
      ? String(ownerRaw)
      : undefined;
  return {
    enabled: Boolean(tg.enabled && tg.botToken && linkedSessionId),
    linkedSessionId,
    ownerChatId,
  };
}

function mirrorKey(sessionId: string, role: string, content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `${sessionId}:${role}:${hash}`;
}

export class SessionMirror extends EventEmitter {
  private readonly recentKeys = new Set<string>();
  private readonly keyQueue: string[] = [];
  private readonly maxKeys = 200;

  private rememberKey(key: string): boolean {
    if (this.recentKeys.has(key)) return false;
    this.recentKeys.add(key);
    this.keyQueue.push(key);
    while (this.keyQueue.length > this.maxKeys) {
      const old = this.keyQueue.shift();
      if (old) this.recentKeys.delete(old);
    }
    return true;
  }

  emitMessage(event: SessionMirrorEvent): void {
    const key = mirrorKey(event.sessionId, event.role, event.content);
    if (!this.rememberKey(key)) return;
    this.emit('session:message', event);
  }

  async mirrorAssistantToTelegram(input: {
    settings: TelegramMirrorSettings;
    sessionId: string;
    content: string;
    source: SessionMessageSource;
    bot: TelegramSender | null;
  }): Promise<void> {
    const { settings, sessionId, content, source, bot } = input;
    if (!settings.enabled || !settings.ownerChatId || !bot) return;
    if (source !== 'web') return;
    if (!settings.linkedSessionId || sessionId !== settings.linkedSessionId) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    const key = mirrorKey(sessionId, 'assistant:mirror-tg', trimmed);
    if (!this.rememberKey(key)) return;

    try {
      await bot.sendMessage(settings.ownerChatId, trimmed);
    } catch {
      // Plain text fallback is handled by TelegramSender adapter in cli.ts
      await bot.sendMessage(settings.ownerChatId, trimmed, undefined);
    }
  }
}

export const sessionMirror = new SessionMirror();
