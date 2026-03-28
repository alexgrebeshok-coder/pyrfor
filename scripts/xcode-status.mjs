import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const IOS_PROJECT_PATH = path.join(process.cwd(), "ios", "App", "App.xcodeproj");

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function trim(value) {
  return value?.trim() || "";
}

function getDeveloperDirMode(developerDir) {
  if (!developerDir) {
    return "missing";
  }

  if (developerDir.includes("/CommandLineTools")) {
    return "command-line-tools";
  }

  if (developerDir.includes(".app/Contents/Developer")) {
    return "full-xcode";
  }

  return "custom";
}

function getVersionParts(stdout) {
  const lines = trim(stdout).split(/\r?\n/).filter(Boolean);
  const xcodeLine = lines.find((line) => line.startsWith("Xcode ")) || "";
  const buildLine = lines.find((line) => line.startsWith("Build version ")) || "";

  return {
    xcodeVersion: xcodeLine.replace(/^Xcode\s+/, "").trim() || null,
    buildVersion: buildLine.replace(/^Build version\s+/, "").trim() || null,
    summary: lines.join(" | ") || null,
  };
}

export function getXcodeStatus() {
  const isMac = process.platform === "darwin";
  const iosProjectPresent = existsSync(IOS_PROJECT_PATH);
  const developerDirResult = isMac ? run("xcode-select", ["-p"]) : null;
  const developerDir = developerDirResult?.status === 0 ? trim(developerDirResult.stdout) : "";
  const developerDirMode = getDeveloperDirMode(developerDir);
  const versionResult = isMac ? run("xcodebuild", ["-version"]) : null;
  const versionParts =
    versionResult && !versionResult.error && versionResult.status === 0
      ? getVersionParts(versionResult.stdout)
      : { xcodeVersion: null, buildVersion: null, summary: null };
  const sdkResult =
    isMac && !versionResult?.error && versionResult?.status === 0 ? run("xcodebuild", ["-showsdks"]) : null;
  const sdkOutput = trim(sdkResult?.stdout);
  const hasIphoneSdk = /iphone(os|simulator)/i.test(sdkOutput);

  const blockers = [];

  if (!isMac) {
    blockers.push(`Current platform is ${process.platform}. CEOClaw iPhone packaging requires macOS.`);
  }

  if (!developerDir) {
    blockers.push("No active Xcode developer directory is selected.");
  } else if (developerDirMode === "command-line-tools") {
    blockers.push("Only Command Line Tools are selected. Switch to the full Xcode app before building the iPhone shell.");
  }

  if (versionResult?.error || (versionResult && versionResult.status !== 0)) {
    blockers.push("xcodebuild is unavailable. Install the full Xcode app and run xcode-select against it.");
  }

  if (versionResult && !versionResult.error && versionResult.status === 0 && !hasIphoneSdk) {
    blockers.push("The active Xcode toolchain does not expose iPhone SDKs yet.");
  }

  if (!iosProjectPresent) {
    blockers.push("The Capacitor iOS project is missing at ios/App/App.xcodeproj.");
  }

  const archiveReady =
    isMac &&
    developerDirMode === "full-xcode" &&
    Boolean(versionParts.xcodeVersion) &&
    hasIphoneSdk &&
    iosProjectPresent;

  return {
    archiveReady,
    blockers,
    buildVersion: versionParts.buildVersion,
    developerDir: developerDir || null,
    developerDirMode,
    iosProjectPath: IOS_PROJECT_PATH,
    iosProjectPresent,
    isMac,
    platform: process.platform,
    sdkSummary: hasIphoneSdk ? "iphone-sdk-available" : "iphone-sdk-missing",
    xcodeSummary: versionParts.summary,
    xcodeVersion: versionParts.xcodeVersion,
  };
}

export function formatXcodeStatusLines(status) {
  const lines = [
    "CEOClaw Xcode status",
    `platform: ${status.platform}`,
    `developer-dir: ${status.developerDir || "missing"} (${status.developerDirMode})`,
    `xcode: ${status.xcodeSummary || "missing"}`,
    `ios-sdk: ${status.sdkSummary}`,
    `ios-project: ${status.iosProjectPresent ? status.iosProjectPath : "missing"}`,
    `archive-ready: ${status.archiveReady ? "yes" : "no"}`,
  ];

  if (status.blockers.length > 0) {
    lines.push("blockers:");
    for (const blocker of status.blockers) {
      lines.push(`- ${blocker}`);
    }
  } else {
    lines.push("blockers: none");
  }

  return lines;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const status = getXcodeStatus();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(formatXcodeStatusLines(status).join("\n"));
  }

  process.exit(status.archiveReady ? 0 : 1);
}
