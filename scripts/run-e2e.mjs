import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const skipE2E = process.env.SKIP_E2E === "true";
const skipReason =
  process.env.SKIP_E2E_REASON ??
  "Playwright e2e is temporarily disabled while the suite is being stabilized.";

if (skipE2E) {
  console.log("[test:e2e] SKIP_E2E=true -> skipping Playwright run.");
  console.log(`[test:e2e] Reason: ${skipReason}`);
  process.exit(0);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["playwright", "test", ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error("[test:e2e] Failed to start Playwright:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
