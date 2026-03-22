import fs from "node:fs";
import path from "node:path";

export interface ReleaseConfig {
  appUrl: string;
  desktopDownloadUrl: string;
  iphoneDownloadUrl: string;
  releaseVersion: string;
}

const DEFAULT_RELEASE_REPOSITORY = "alexgrebeshok-coder/ceoclaw";

function normalizeHref(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function readTauriVersion() {
  try {
    const tauriConfigPath = path.join(process.cwd(), "src-tauri", "tauri.conf.json");
    const raw = fs.readFileSync(tauriConfigPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version?.trim() || null;
  } catch {
    return null;
  }
}

function getReleaseRepository(env: NodeJS.ProcessEnv) {
  return env.NEXT_PUBLIC_RELEASE_REPOSITORY?.trim() || env.GITHUB_REPOSITORY?.trim() || DEFAULT_RELEASE_REPOSITORY;
}

function buildDesktopDownloadUrl(version: string, repository: string) {
  return `https://github.com/${repository}/releases/download/v${version}/CEOClaw_${version}_aarch64.dmg`;
}

export function getReleaseConfig(env: NodeJS.ProcessEnv = process.env): ReleaseConfig {
  const releaseVersion = normalizeHref(env.NEXT_PUBLIC_APP_VERSION, readTauriVersion() || "local-dev");
  const desktopDownloadUrl =
    normalizeHref(env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL, "") ||
    (releaseVersion !== "local-dev" ? buildDesktopDownloadUrl(releaseVersion, getReleaseRepository(env)) : "#desktop");

  return {
    appUrl: normalizeHref(env.NEXT_PUBLIC_APP_URL, "/"),
    desktopDownloadUrl,
    iphoneDownloadUrl: normalizeHref(env.NEXT_PUBLIC_IOS_DOWNLOAD_URL, "#iphone"),
    releaseVersion,
  };
}

export function isExternalReleaseHref(href: string) {
  return /^https?:\/\//i.test(href);
}

export function buildGitHubDesktopDownloadUrl(version: string, repository = DEFAULT_RELEASE_REPOSITORY) {
  return buildDesktopDownloadUrl(version, repository);
}
