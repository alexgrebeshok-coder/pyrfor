const DEFAULT_SITE_URL = "http://localhost:3000";
function normalizeSiteUrl(rawUrl) {
    return new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`);
}
export function getSiteUrl() {
    var _a, _b;
    const configuredUrl = (_b = (_a = process.env.NEXT_PUBLIC_SITE_URL) !== null && _a !== void 0 ? _a : process.env.VERCEL_URL) !== null && _b !== void 0 ? _b : DEFAULT_SITE_URL;
    return normalizeSiteUrl(configuredUrl);
}
export const siteUrl = getSiteUrl();
