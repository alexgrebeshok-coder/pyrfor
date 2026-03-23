const DEFAULT_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(rawUrl: string): URL {
  return new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`);
}

export function getSiteUrl(): URL {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL ?? DEFAULT_SITE_URL;
  return normalizeSiteUrl(configuredUrl);
}

export const siteUrl = getSiteUrl();
