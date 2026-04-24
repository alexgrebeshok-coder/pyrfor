"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteUrl = void 0;
exports.getSiteUrl = getSiteUrl;
const DEFAULT_SITE_URL = "http://localhost:3000";
function normalizeSiteUrl(rawUrl) {
    return new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`);
}
function getSiteUrl() {
    const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL ?? DEFAULT_SITE_URL;
    return normalizeSiteUrl(configuredUrl);
}
exports.siteUrl = getSiteUrl();
