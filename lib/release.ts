import fs from "node:fs";
import path from "node:path";

export interface ReleaseConfig {
  appUrl: string;
  desktopDownloadUrl: string;
  iphoneDownloadUrl: string;
  releaseVersion: string;
}

export type ReleaseSurfaceId = "web" | "desktop" | "iphone";
export type ReleaseSurfaceMode =
  | "current-domain"
  | "local-preview"
  | "public-web"
  | "github-release"
  | "public-download"
  | "testflight"
  | "app-store"
  | "pending"
  | "invalid";

export interface ReleaseSurfaceStatus {
  configured: boolean;
  href: string;
  installReady: boolean;
  label: string;
  mode: ReleaseSurfaceMode;
  note: string;
  statusLabel: string;
}

export interface ReleaseNotesSummary {
  available: boolean;
  items: string[];
  sourceLabel: string;
}

export interface ReleaseStatus {
  desktop: ReleaseSurfaceStatus;
  iphone: ReleaseSurfaceStatus;
  installReadyCount: number;
  installReadyTotal: number;
  nextBlocker: string;
  notes: ReleaseNotesSummary;
  releaseVersion: string;
  web: ReleaseSurfaceStatus;
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

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function classifyWebSurface(href: string): ReleaseSurfaceStatus {
  if (href.startsWith("/")) {
    return {
      configured: true,
      href,
      installReady: false,
      label: "Текущий домен",
      mode: "current-domain",
      note: "Страница использует текущий домен. Для операторского release-audit лучше явно указать production URL.",
      statusLabel: "Нужен публичный URL",
    };
  }

  try {
    const parsed = new URL(href);

    if (isLocalHostname(parsed.hostname)) {
      return {
        configured: true,
        href: parsed.href,
        installReady: false,
        label: "Локальный preview",
        mode: "local-preview",
        note: "Канал годится для локального smoke, но не для install-ready релиза.",
        statusLabel: "Локальный preview",
      };
    }

    return {
      configured: true,
      href: parsed.href,
      installReady: true,
      label: "Публичный URL",
      mode: "public-web",
      note: "Это живая веб-цель, на которую должны смотреть desktop и iPhone оболочки.",
      statusLabel: "Живой веб",
    };
  } catch {
    return {
      configured: false,
      href,
      installReady: false,
      label: "Невалидный URL",
      mode: "invalid",
      note: "Укажите валидный абсолютный URL для веб-канала.",
      statusLabel: "Нужна правка",
    };
  }
}

function classifyDesktopSurface(href: string): ReleaseSurfaceStatus {
  if (!href || href.startsWith("#")) {
    return {
      configured: false,
      href: "#desktop",
      installReady: false,
      label: "Pending fallback",
      mode: "pending",
      note: "macOS канал ещё не привязан к реальному артефакту.",
      statusLabel: "Нужна ссылка",
    };
  }

  try {
    const parsed = new URL(href);

    if (isLocalHostname(parsed.hostname)) {
      return {
        configured: true,
        href: parsed.href,
        installReady: false,
        label: "Локальный preview",
        mode: "local-preview",
        note: "Локальный URL полезен для отладки, но не должен быть публичным install channel.",
        statusLabel: "Локальный preview",
      };
    }

    if (parsed.hostname === "github.com" && parsed.pathname.includes("/releases/download/")) {
      return {
        configured: true,
        href: parsed.href,
        installReady: true,
        label: "GitHub Release asset",
        mode: "github-release",
        note: "Канал использует version-derived GitHub Release asset и подходит для install hub.",
        statusLabel: "Готово к загрузке",
      };
    }

    return {
      configured: true,
      href: parsed.href,
      installReady: true,
      label: "Публичный download URL",
      mode: "public-download",
      note: "Публичная ссылка ведёт на отдельный download channel вне GitHub Release.",
      statusLabel: "Готово к загрузке",
    };
  } catch {
    return {
      configured: false,
      href,
      installReady: false,
      label: "Невалидный URL",
      mode: "invalid",
      note: "Проверьте формат ссылки на macOS artifact.",
      statusLabel: "Нужна правка",
    };
  }
}

function classifyIphoneSurface(href: string): ReleaseSurfaceStatus {
  if (!href || href.startsWith("#")) {
    return {
      configured: false,
      href: "#iphone",
      installReady: false,
      label: "Pending fallback",
      mode: "pending",
      note: "iPhone канал ещё не привязан к TestFlight или App Store.",
      statusLabel: "Нужна ссылка на TestFlight",
    };
  }

  try {
    const parsed = new URL(href);

    if (isLocalHostname(parsed.hostname)) {
      return {
        configured: true,
        href: parsed.href,
        installReady: false,
        label: "Локальный preview",
        mode: "local-preview",
        note: "Такой URL подходит только для simulator/dev handoff, не для публичной установки.",
        statusLabel: "Локальный preview",
      };
    }

    if (parsed.hostname === "testflight.apple.com") {
      return {
        configured: true,
        href: parsed.href,
        installReady: true,
        label: "TestFlight",
        mode: "testflight",
        note: "Beta-distribution путь уже указывает на TestFlight и честно закрывает install flow.",
        statusLabel: "TestFlight готов",
      };
    }

    if (parsed.hostname === "apps.apple.com") {
      return {
        configured: true,
        href: parsed.href,
        installReady: true,
        label: "App Store",
        mode: "app-store",
        note: "Публичный канал указывает на App Store страницу приложения.",
        statusLabel: "App Store готов",
      };
    }

    return {
      configured: true,
      href: parsed.href,
      installReady: true,
      label: "Публичный mobile URL",
      mode: "public-download",
      note: "Канал использует нестандартный внешний URL. Убедитесь, что это именно пользовательский install flow.",
      statusLabel: "Внешний install URL",
    };
  } catch {
    return {
      configured: false,
      href,
      installReady: false,
      label: "Невалидный URL",
      mode: "invalid",
      note: "Проверьте формат ссылки на TestFlight или App Store.",
      statusLabel: "Нужна правка",
    };
  }
}

function readReleaseNotes(version: string): ReleaseNotesSummary {
  const notesPath = path.join(process.cwd(), "releases", `v${version}.md`);

  if (!fs.existsSync(notesPath)) {
    return {
      available: false,
      items: [
        "Версионный release-notes файл пока не найден.",
        "Создайте releases/v{version}.md перед публичным freeze, чтобы install hub не обещал больше, чем реально собрано.",
      ],
      sourceLabel: `Нет файла ${path.relative(process.cwd(), notesPath)}`,
    };
  }

  const raw = fs.readFileSync(notesPath, "utf8");
  const bulletLines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .slice(0, 4);

  const items = bulletLines.length > 0
    ? bulletLines
    : raw
        .split(/\r?\n\r?\n/)
        .map((block) => block.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 3);

  return {
    available: true,
    items,
    sourceLabel: `Из ${path.relative(process.cwd(), notesPath)}`,
  };
}

function getNextBlocker(web: ReleaseSurfaceStatus, desktop: ReleaseSurfaceStatus, iphone: ReleaseSurfaceStatus, notes: ReleaseNotesSummary) {
  if (!web.installReady) {
    return "Указать NEXT_PUBLIC_APP_URL на живой production URL, чтобы install hub вёл не в локальный preview.";
  }

  if (!desktop.installReady) {
    return "Опубликовать публичный macOS artifact URL или держать GitHub Release asset живым.";
  }

  if (!iphone.installReady) {
    return "Добить iPhone archive/TestFlight path и прописать NEXT_PUBLIC_IOS_DOWNLOAD_URL.";
  }

  if (!notes.available) {
    return "Добавить versioned release notes перед финальным freeze.";
  }

  return "Каналы установки выглядят честно. Остался финальный audit / freeze.";
}

export function getReleaseStatus(env: NodeJS.ProcessEnv = process.env): ReleaseStatus {
  const config = getReleaseConfig(env);
  const web = classifyWebSurface(config.appUrl);
  const desktop = classifyDesktopSurface(config.desktopDownloadUrl);
  const iphone = classifyIphoneSurface(config.iphoneDownloadUrl);
  const notes = readReleaseNotes(config.releaseVersion);

  return {
    desktop,
    iphone,
    installReadyCount: [web, desktop, iphone].filter((surface) => surface.installReady).length,
    installReadyTotal: 3,
    nextBlocker: getNextBlocker(web, desktop, iphone, notes),
    notes,
    releaseVersion: config.releaseVersion,
    web,
  };
}
