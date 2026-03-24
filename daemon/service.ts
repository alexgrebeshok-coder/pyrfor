/**
 * CEOClaw Daemon — Platform Service Management
 *
 * Installs/manages the daemon as a system service:
 * - macOS: LaunchAgent (launchctl)
 * - Linux: systemd user service
 *
 * Ported from OpenClaw, improved with:
 * - TypeScript types
 * - Simpler config (no Tailscale, no Windows for now)
 * - Direct process.execPath usage
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { createLogger } from "./logger";

const log = createLogger("service");

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ServiceManager {
  install(options: ServiceOptions): void;
  uninstall(): void;
  start(): void;
  stop(): void;
  restart(): void;
  isInstalled(): boolean;
  isRunning(): boolean;
  status(): ServiceStatus;
}

export interface ServiceOptions {
  port: number;
  logDir?: string;
  configPath?: string;
  env?: Record<string, string>;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  uptime?: string;
}

// ─── macOS LaunchAgent ─────────────────────────────────────────────────────

function createMacOSService(): ServiceManager {
  const plistName = "dev.ceoclaw.daemon";
  const plistDir = resolve(homedir(), "Library/LaunchAgents");
  const plistPath = resolve(plistDir, `${plistName}.plist`);

  function getPid(): number | undefined {
    try {
      const output = execSync(
        `launchctl list | grep ${plistName}`,
        { encoding: "utf-8" }
      ).trim();
      const parts = output.split("\t");
      const pid = parseInt(parts[0], 10);
      return isNaN(pid) || pid <= 0 ? undefined : pid;
    } catch {
      return undefined;
    }
  }

  return {
    install(options: ServiceOptions) {
      const daemonScript = resolve(__dirname, "index.ts");
      const tsxPath = resolve(process.cwd(), "node_modules/.bin/tsx");
      const logDir = options.logDir ?? resolve(homedir(), ".ceoclaw/logs");

      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const envVars: Record<string, string> = {
        NODE_ENV: "production",
        CEOCLAW_DAEMON_PORT: String(options.port),
        ...options.env,
      };

      // Load .env file if it exists
      const envFile = resolve(process.cwd(), ".env");
      if (existsSync(envFile)) {
        const envContent = readFileSync(envFile, "utf-8");
        for (const line of envContent.split("\n")) {
          const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
          if (match && !envVars[match[1]]) {
            envVars[match[1]] = match[2].replace(/^["']|["']$/g, "");
          }
        }
      }

      const envDict = Object.entries(envVars)
        .map(
          ([k, v]) =>
            `      <key>${k}</key>\n      <string>${escapeXml(v)}</string>`
        )
        .join("\n");

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${tsxPath}</string>
    <string>${daemonScript}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${process.cwd()}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envDict}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon-stderr.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>`;

      if (!existsSync(plistDir)) {
        mkdirSync(plistDir, { recursive: true });
      }

      writeFileSync(plistPath, plist, "utf-8");
      log.info("LaunchAgent installed", { path: plistPath });
    },

    uninstall() {
      this.stop();
      if (existsSync(plistPath)) {
        unlinkSync(plistPath);
        log.info("LaunchAgent uninstalled");
      }
    },

    start() {
      if (!existsSync(plistPath)) {
        throw new Error("Service not installed. Run 'ceoclaw daemon install' first.");
      }
      try {
        execSync(`launchctl load -w ${plistPath}`, { stdio: "pipe" });
        log.info("LaunchAgent started");
      } catch (err) {
        log.error("Failed to start LaunchAgent", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },

    stop() {
      try {
        execSync(`launchctl unload ${plistPath}`, { stdio: "pipe" });
        log.info("LaunchAgent stopped");
      } catch {
        // May not be loaded
      }
    },

    restart() {
      this.stop();
      this.start();
    },

    isInstalled() {
      return existsSync(plistPath);
    },

    isRunning() {
      return getPid() !== undefined;
    },

    status() {
      const pid = getPid();
      return {
        installed: this.isInstalled(),
        running: pid !== undefined,
        pid,
      };
    },
  };
}

// ─── Linux systemd ─────────────────────────────────────────────────────────

function createLinuxService(): ServiceManager {
  const serviceName = "ceoclaw-daemon";
  const serviceDir = resolve(homedir(), ".config/systemd/user");
  const servicePath = resolve(serviceDir, `${serviceName}.service`);

  function getPid(): number | undefined {
    try {
      const output = execSync(
        `systemctl --user show ${serviceName} --property=MainPID`,
        { encoding: "utf-8" }
      ).trim();
      const pid = parseInt(output.split("=")[1], 10);
      return isNaN(pid) || pid <= 0 ? undefined : pid;
    } catch {
      return undefined;
    }
  }

  return {
    install(options: ServiceOptions) {
      const daemonScript = resolve(__dirname, "index.ts");
      const tsxPath = resolve(process.cwd(), "node_modules/.bin/tsx");
      const logDir = options.logDir ?? resolve(homedir(), ".ceoclaw/logs");

      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const envVars = Object.entries({
        NODE_ENV: "production",
        CEOCLAW_DAEMON_PORT: String(options.port),
        ...options.env,
      })
        .map(([k, v]) => `Environment=${k}=${v}`)
        .join("\n");

      const unit = `[Unit]
Description=CEOClaw AI PM Daemon
After=network.target

[Service]
Type=simple
ExecStart=${tsxPath} ${daemonScript}
WorkingDirectory=${process.cwd()}
${envVars}
Restart=on-failure
RestartSec=10
StandardOutput=append:${logDir}/daemon-stdout.log
StandardError=append:${logDir}/daemon-stderr.log

[Install]
WantedBy=default.target
`;

      if (!existsSync(serviceDir)) {
        mkdirSync(serviceDir, { recursive: true });
      }

      writeFileSync(servicePath, unit, "utf-8");
      execSync("systemctl --user daemon-reload", { stdio: "pipe" });
      log.info("systemd service installed", { path: servicePath });
    },

    uninstall() {
      this.stop();
      if (existsSync(servicePath)) {
        unlinkSync(servicePath);
        execSync("systemctl --user daemon-reload", { stdio: "pipe" });
        log.info("systemd service uninstalled");
      }
    },

    start() {
      execSync(`systemctl --user start ${serviceName}`, { stdio: "pipe" });
      log.info("systemd service started");
    },

    stop() {
      try {
        execSync(`systemctl --user stop ${serviceName}`, { stdio: "pipe" });
        log.info("systemd service stopped");
      } catch {
        // May not be running
      }
    },

    restart() {
      execSync(`systemctl --user restart ${serviceName}`, { stdio: "pipe" });
      log.info("systemd service restarted");
    },

    isInstalled() {
      return existsSync(servicePath);
    },

    isRunning() {
      return getPid() !== undefined;
    },

    status() {
      const pid = getPid();
      return {
        installed: this.isInstalled(),
        running: pid !== undefined,
        pid,
      };
    },
  };
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createServiceManager(): ServiceManager {
  const os = platform();

  if (os === "darwin") {
    return createMacOSService();
  }

  if (os === "linux") {
    return createLinuxService();
  }

  throw new Error(
    `Platform ${os} not supported for daemon service. Use 'npx tsx daemon/index.ts' to run manually.`
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
