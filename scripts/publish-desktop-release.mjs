import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { loadStandardEnvFiles } from "./load-standard-env.mjs";

loadStandardEnvFiles();

const repoRoot = process.cwd();
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(await fs.readFile(tauriConfigPath, "utf8"));
const version = tauriConfig.version?.trim();

if (!version) {
  throw new Error("Unable to determine CEOClaw desktop version from src-tauri/tauri.conf.json.");
}

const tag = `v${version}`;
const artifactName = `CEOClaw_${version}_aarch64.dmg`;
const artifactPath = path.join(repoRoot, "src-tauri", "target", "release", "bundle", "dmg", artifactName);
const notesPath = path.join(repoRoot, "releases", `${tag}.md`);

if (!existsSync(artifactPath)) {
  throw new Error(`Desktop artifact not found: ${artifactPath}`);
}

if (!existsSync(notesPath)) {
  throw new Error(`Release notes file not found: ${notesPath}`);
}

const repo = (process.env.GITHUB_REPOSITORY || execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
  encoding: "utf8",
}).trim());

const digest = execFileSync("shasum", ["-a", "256", artifactPath], { encoding: "utf8" }).trim().split(/\s+/)[0];
const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${artifactName}`;
const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;

let releaseExists = false;
try {
  execFileSync("gh", ["release", "view", tag, "--repo", repo], { stdio: "pipe" });
  releaseExists = true;
} catch {
  releaseExists = false;
}

if (releaseExists) {
  execFileSync("gh", ["release", "upload", tag, artifactPath, "--clobber", "--repo", repo], { stdio: "inherit" });
  execFileSync("gh", ["release", "edit", tag, "--notes-file", notesPath, "--repo", repo], { stdio: "inherit" });
} else {
  execFileSync(
    "gh",
    ["release", "create", tag, artifactPath, "--title", `CEOClaw ${version}`, "--notes-file", notesPath, "--repo", repo],
    { stdio: "inherit" }
  );
}

console.log("CEOClaw desktop release published.");
console.log(`tag: ${tag}`);
console.log(`release: ${releaseUrl}`);
console.log(`download: ${downloadUrl}`);
console.log(`sha256: ${digest}`);
