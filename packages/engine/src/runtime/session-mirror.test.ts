// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuntimeConfigSchema } from './config';
import {
  SessionMirror,
  getTelegramMirrorSettings,
} from './session-mirror';

describe('getTelegramMirrorSettings', () => {
  it('enables mirror when token, linked id, and enabled flag are set', () => {
    const cfg = RuntimeConfigSchema.parse({
      telegram: {
        enabled: true,
        botToken: 'test-token',
        linkedSessionId: 'sess-pyrfor-main',
        ownerChatId: 12345,
      },
    });
    const settings = getTelegramMirrorSettings(cfg);
    expect(settings.enabled).toBe(true);
    expect(settings.linkedSessionId).toBe('sess-pyrfor-main');
    expect(settings.ownerChatId).toBe('12345');
  });

  it('parses linkedSessionId from schema', () => {
    const cfg = RuntimeConfigSchema.parse({
      telegram: { linkedSessionId: 'sess-custom' },
    });
    expect(cfg.telegram.linkedSessionId).toBe('sess-custom');
  });
});

describe('SessionMirror', () => {
  let mirror: SessionMirror;

  beforeEach(() => {
    mirror = new SessionMirror();
  });

  it('dedupes identical session:message events', () => {
    const events: unknown[] = [];
    mirror.on('session:message', (e) => events.push(e));
    const payload = {
      sessionId: 'sess-1',
      role: 'user' as const,
      content: 'hello',
      source: 'telegram' as const,
      ts: 1,
    };
    mirror.emitMessage(payload);
    mirror.emitMessage(payload);
    expect(events).toHaveLength(1);
  });

  it('mirrors assistant web replies to telegram', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const bot = { sendMessage };
    await mirror.mirrorAssistantToTelegram({
      settings: {
        enabled: true,
        linkedSessionId: 'sess-1',
        ownerChatId: '99',
      },
      sessionId: 'sess-1',
      content: 'Hi from IDE',
      source: 'web',
      bot,
    });
    expect(sendMessage).toHaveBeenCalledWith('99', 'Hi from IDE');
  });

  it('skips mirror for telegram-origin assistant messages', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    await mirror.mirrorAssistantToTelegram({
      settings: {
        enabled: true,
        linkedSessionId: 'sess-1',
        ownerChatId: '99',
      },
      sessionId: 'sess-1',
      content: 'Hi from TG',
      source: 'telegram',
      bot: { sendMessage },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
