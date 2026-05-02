// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldAutostartTelegramWithDaemon } from './telegram-autostart';

describe('daemon Telegram autostart decision', () => {
  it('autostarts Telegram when daemon config enables it and a config token exists', () => {
    expect(shouldAutostartTelegramWithDaemon({
      telegramEnabled: true,
      configToken: 'configured-token',
    })).toBe(true);
  });

  it('autostarts Telegram when daemon config enables it and env token exists', () => {
    expect(shouldAutostartTelegramWithDaemon({
      telegramEnabled: true,
      envToken: 'env-token',
    })).toBe(true);
  });

  it('falls back to gateway-only daemon when disabled or token is missing', () => {
    expect(shouldAutostartTelegramWithDaemon({
      telegramEnabled: false,
      configToken: 'configured-token',
    })).toBe(false);
    expect(shouldAutostartTelegramWithDaemon({
      telegramEnabled: true,
    })).toBe(false);
  });

  it('honors PYRFOR_TELEGRAM_AUTOSTART rollback values', () => {
    for (const autostartEnv of ['false', 'FALSE', '0']) {
      expect(shouldAutostartTelegramWithDaemon({
        telegramEnabled: true,
        configToken: 'configured-token',
        autostartEnv,
      })).toBe(false);
    }
  });
});
