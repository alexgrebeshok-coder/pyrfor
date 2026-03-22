import fs from "node:fs";
import path from "node:path";

import { loadStandardEnvFiles } from "./load-standard-env.mjs";

loadStandardEnvFiles();

const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const rawIphoneUrl = process.env.NEXT_PUBLIC_IOS_DOWNLOAD_URL?.trim();
const releaseVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || (() => {
  try {
    const tauriConfigPath = path.join(process.cwd(), "src-tauri", "tauri.conf.json");
    const parsed = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
    return parsed.version?.trim() || "local-dev";
  } catch {
    return "local-dev";
  }
})();

const releaseRepository = process.env.NEXT_PUBLIC_RELEASE_REPOSITORY?.trim() || process.env.GITHUB_REPOSITORY?.trim() || "alexgrebeshok-coder/ceoclaw";
const defaultDesktopUrl = releaseVersion !== "local-dev"
  ? `https://github.com/${releaseRepository}/releases/download/v${releaseVersion}/CEOClaw_${releaseVersion}_aarch64.dmg`
  : "#desktop";
const rawDesktopUrl = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL?.trim() || defaultDesktopUrl;

if (!rawAppUrl) {
  throw new Error(
    "NEXT_PUBLIC_APP_URL is required for the release preflight. Set it to the live production URL or the local development URL before packaging."
  );
}

let appUrl;

try {
  const parsed = new URL(rawAppUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  appUrl = parsed.href;
} catch (error) {
  throw new Error(`NEXT_PUBLIC_APP_URL must be a valid absolute http(s) URL. Received "${rawAppUrl}".`, { cause: error });
}

function classify(value, fallbackLabel) {
  if (!value) {
    return { href: fallbackLabel, configured: false, mode: "fallback" };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { href: value, configured: false, mode: "unsupported" };
    }

    const host = parsed.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return {
      href: parsed.href,
      configured: true,
      mode: isLocalHost ? "local" : "external",
    };
  } catch {
    return { href: value, configured: false, mode: "invalid" };
  }
}

const desktop = classify(rawDesktopUrl, "#desktop");
const iphone = classify(rawIphoneUrl, "#iphone");
const appMode = new URL(appUrl).hostname === "localhost" || new URL(appUrl).hostname === "127.0.0.1" || new URL(appUrl).hostname === "::1"
  ? "local"
  : "external";

const lines = [
  "CEOClaw release preflight",
  `version: ${releaseVersion}`,
  `web: ${appUrl} (${appMode})`,
  `desktop: ${desktop.href} (${desktop.configured ? desktop.mode : "fallback"})`,
  `iphone: ${iphone.href} (${iphone.configured ? iphone.mode : "fallback"})`,
];

console.log(lines.join("\n"));
