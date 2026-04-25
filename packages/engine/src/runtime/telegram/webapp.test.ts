import { describe, expect, it } from 'vitest';
import { getTelegramWebAppUrl } from './webapp';

describe('getTelegramWebAppUrl', () => {
  it('returns null when TELEGRAM_WEBAPP_URL is missing', () => {
    expect(getTelegramWebAppUrl({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns null when TELEGRAM_WEBAPP_URL is blank', () => {
    expect(getTelegramWebAppUrl({ TELEGRAM_WEBAPP_URL: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns the configured TELEGRAM_WEBAPP_URL', () => {
    expect(
      getTelegramWebAppUrl({
        TELEGRAM_WEBAPP_URL: 'https://example.com/app',
      } as NodeJS.ProcessEnv)
    ).toBe('https://example.com/app');
  });

  it('returns null for http:// URLs (Telegram requires HTTPS)', () => {
    expect(
      getTelegramWebAppUrl({
        TELEGRAM_WEBAPP_URL: 'http://localhost:18790/app',
      } as NodeJS.ProcessEnv)
    ).toBeNull();
  });
});
