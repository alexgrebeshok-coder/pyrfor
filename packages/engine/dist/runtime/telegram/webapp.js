export function getTelegramWebAppUrl(env = process.env) {
    var _a;
    const url = (_a = env.TELEGRAM_WEBAPP_URL) === null || _a === void 0 ? void 0 : _a.trim();
    if (!url)
        return null;
    // Telegram requires HTTPS for web_app buttons; reject http:// silently
    // so callers fall back to plain text greeting and skip setChatMenuButton.
    if (!/^https:\/\//i.test(url))
        return null;
    return url;
}
