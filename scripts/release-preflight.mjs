import fs from "node:fs";
import path from "node:path";

import { loadStandardEnvFiles } from "./load-standard-env.mjs";
import { getXcodeStatus } from "./xcode-status.mjs";

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
const xcodeStatus = getXcodeStatus();
const releaseNotesPath = path.join(process.cwd(), "releases", `v${releaseVersion}.md`);
const releaseNotesExists = fs.existsSync(releaseNotesPath);
const installReadyCount = [appMode === "external", desktop.configured && desktop.mode === "external", iphone.configured && iphone.mode === "external"].filter(Boolean).length;

function classifyIphoneChannel(value) {
  if (!value) {
    return "pending";
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname === "testflight.apple.com") {
      return "testflight";
    }
    if (parsed.hostname === "apps.apple.com") {
      return "app-store";
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
      return "local";
    }
    return "external";
  } catch {
    return "invalid";
  }
}

function classifyDesktopChannel(value) {
  if (!value) {
    return "pending";
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname === "github.com" && parsed.pathname.includes("/releases/download/")) {
      return "github-release";
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
      return "local";
    }
    return "public-download";
  } catch {
    return "invalid";
  }
}

function getNextBlocker() {
  if (appMode !== "external") {
    return "Point NEXT_PUBLIC_APP_URL at the live production web URL.";
  }

  if (!(desktop.configured && desktop.mode === "external")) {
    return "Publish the macOS artifact URL or keep the GitHub Release asset live.";
  }

  if (!xcodeStatus.archiveReady) {
    return "Move the iPhone archive step onto a full Xcode machine before publishing the mobile channel.";
  }

  if (!(iphone.configured && iphone.mode === "external")) {
    return "Publish the TestFlight or App Store URL in NEXT_PUBLIC_IOS_DOWNLOAD_URL.";
  }

  if (!releaseNotesExists) {
    return "Add a versioned release note file in releases/ before the final freeze.";
  }

  return "No install-link blockers detected. Finish the release audit and freeze.";
}

const lines = [
  "CEOClaw release preflight",
  `version: ${releaseVersion}`,
  `web: ${appUrl} (${appMode})`,
  `desktop: ${desktop.href} (${desktop.configured ? classifyDesktopChannel(desktop.href) : "pending"})`,
  `iphone: ${iphone.href} (${iphone.configured ? classifyIphoneChannel(iphone.href) : "pending"})`,
  `install-ready: ${installReadyCount}/3`,
  `release-notes: ${releaseNotesExists ? path.relative(process.cwd(), releaseNotesPath) : "missing"}`,
  `xcode: ${xcodeStatus.archiveReady ? "archive-ready" : xcodeStatus.developerDirMode}`,
  `next-blocker: ${getNextBlocker()}`,
];

console.log(lines.join("\n"));
