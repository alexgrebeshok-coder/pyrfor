import assert from "node:assert/strict";
import { test } from "vitest";

import { getReleaseConfig, getReleaseStatus, isExternalReleaseHref } from "@/lib/release";

test("defaults release config when env is missing", () => {
  const config = getReleaseConfig({} as NodeJS.ProcessEnv);

  assert.equal(config.appUrl, "/");
  assert.equal(
    config.desktopDownloadUrl,
    "https://github.com/alexgrebeshok-coder/ceoclaw/releases/download/v1.0.0/CEOClaw_1.0.0_aarch64.dmg"
  );
  assert.equal(config.iphoneDownloadUrl, "#iphone");
  assert.equal(config.releaseVersion, "1.0.0");
});

test("reads configured release values", () => {
  const config = getReleaseConfig({
    NEXT_PUBLIC_APP_URL: "https://app.ceoclaw.example",
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL: "https://downloads.ceoclaw.example/ceoclaw.dmg",
    NEXT_PUBLIC_IOS_DOWNLOAD_URL: "https://testflight.apple.com/join/example",
    NEXT_PUBLIC_APP_VERSION: "1.2.3",
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(config.appUrl, "https://app.ceoclaw.example");
  assert.equal(config.desktopDownloadUrl, "https://downloads.ceoclaw.example/ceoclaw.dmg");
  assert.equal(config.iphoneDownloadUrl, "https://testflight.apple.com/join/example");
  assert.equal(config.releaseVersion, "1.2.3");
  assert.equal(isExternalReleaseHref(config.desktopDownloadUrl), true);
  assert.equal(isExternalReleaseHref(config.appUrl), true);
  assert.equal(isExternalReleaseHref("#desktop"), false);
});

test("classifies install channels and next blocker honestly", () => {
  const status = getReleaseStatus({
    NEXT_PUBLIC_APP_URL: "https://app.ceoclaw.example",
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL:
      "https://github.com/alexgrebeshok-coder/ceoclaw/releases/download/v1.2.3/CEOClaw_1.2.3_aarch64.dmg",
    NEXT_PUBLIC_APP_VERSION: "1.2.3",
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(status.web.mode, "public-web");
  assert.equal(status.desktop.mode, "github-release");
  assert.equal(status.iphone.mode, "pending");
  assert.equal(status.installReadyCount, 2);
  assert.match(status.nextBlocker, /NEXT_PUBLIC_IOS_DOWNLOAD_URL|iPhone archive\/TestFlight path/i);
});
