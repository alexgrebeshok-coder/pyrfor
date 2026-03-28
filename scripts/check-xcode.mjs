import { formatXcodeStatusLines, getXcodeStatus } from "./xcode-status.mjs";

const status = getXcodeStatus();

if (!status.archiveReady) {
  console.error("CEOClaw iPhone build requires full Xcode.");
  console.error(formatXcodeStatusLines(status).join("\n"));
  console.error("Install Xcode from the Mac App Store, then run:");
  console.error("sudo xcode-select -s /Applications/Xcode.app/Contents/Developer");
  console.error("xcodebuild -version");
  process.exit(1);
}

console.log(formatXcodeStatusLines(status).join("\n"));
