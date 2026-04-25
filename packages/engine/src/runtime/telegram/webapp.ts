export function getTelegramWebAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.TELEGRAM_WEBAPP_URL?.trim();
  if (!url) return null;
  // Telegram requires HTTPS for web_app buttons; reject http:// silently
  // so callers fall back to plain text greeting and skip setChatMenuButton.
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}
