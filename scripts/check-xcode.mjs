import { spawnSync } from "node:child_process";

function fail(message) {
  console.error("CEOClaw iPhone build requires full Xcode.");
  console.error(message);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail(`Current platform: ${process.platform}. Use a macOS machine with Xcode installed.`);
}

const developerDirResult = spawnSync("xcode-select", ["-p"], { encoding: "utf8" });
const developerDir = developerDirResult.status === 0 ? developerDirResult.stdout.trim() : "";
const xcodeVersionResult = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });

if (xcodeVersionResult.error || xcodeVersionResult.status !== 0) {
  const details = [
    developerDir ? `Active developer directory: ${developerDir}` : null,
    xcodeVersionResult.error ? `Detected error: ${xcodeVersionResult.error.message}` : null,
    xcodeVersionResult.stderr?.trim() ? `xcodebuild stderr: ${xcodeVersionResult.stderr.trim()}` : null,
    "Install Xcode from the Mac App Store, then run:",
    "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    "xcodebuild -version",
  ].filter(Boolean).join("\n");
  fail(details);
}

console.log("Xcode toolchain available.");
console.log(xcodeVersionResult.stdout.trim());
if (developerDir) {
  console.log(`Developer directory: ${developerDir}`);
}
