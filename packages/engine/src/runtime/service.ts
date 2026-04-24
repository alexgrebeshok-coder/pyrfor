/**
 * Runtime Service Manager — OS-level process supervision.
 *
 * Supports:
 *   - macOS:  LaunchAgent  (launchctl)      ~/Library/LaunchAgents/dev.pyrfor.runtime.plist
 *   - Linux:  systemd user unit             ~/.config/systemd/user/pyrfor-runtime.service
 *
 * Ported from daemon/service.ts; async-first, ESM-native, no execSync.
 */

import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as _execFile } from 'node:child_process';
import { writeFile, readFile, unlink, mkdir, access } from 'node:fs/promises';
import { logger } from '../observability/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLIST_NAME = 'dev.pyrfor.runtime';
const SERVICE_NAME = 'pyrfor-runtime';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InstallOptions {
  executablePath: string;
  args?: string[];
  envFile?: string;
  envOverrides?: Record<string, string>;
}

export interface ServiceStatus {
  running: boolean;
  platform: string;
  details?: unknown;
}

export interface ServiceManager {
  install(options: InstallOptions): Promise<void>;
  uninstall(): Promise<void>;
  status(): Promise<ServiceStatus>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  const content = await readFile(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Thin async wrapper so tests can mock node:child_process execFile via callback interception. */
function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    _execFile(file, args, (err, stdout, stderr) => {
      if (err) {
        const enriched = err as Error & { stdout?: string; stderr?: string };
        enriched.stdout = typeof stdout === 'string' ? stdout : '';
        enriched.stderr = typeof stderr === 'string' ? stderr : '';
        rej(enriched);
      } else {
        res({
        stdout: String(stdout),
        stderr: String(stderr),
      });
      }
    });
  });
}

function getEngineRoot(): string {
  // service.ts lives at packages/engine/src/runtime/ — go up 2 dirs to reach packages/engine
  const __filename = fileURLToPath(import.meta.url);
  return resolve(dirname(__filename), '..', '..');
}

// ─── macOS LaunchAgent ────────────────────────────────────────────────────────

function createDarwinServiceManager(workingDir: string): ServiceManager {
  const plistDir = resolve(homedir(), 'Library/LaunchAgents');
  const plistPath = resolve(plistDir, `${PLIST_NAME}.plist`);
  const logDir = resolve(homedir(), 'Library/Logs/pyrfor-runtime');

  return {
    async install(options: InstallOptions): Promise<void> {
      let envVars: Record<string, string> = {};
      if (options.envFile) {
        envVars = await parseEnvFile(options.envFile);
      }
      if (options.envOverrides) {
        envVars = { ...envVars, ...options.envOverrides };
      }

      const programArgs = [options.executablePath, ...(options.args ?? [])];
      const envDict = Object.entries(envVars)
        .map(([k, v]) => `      <key>${escapeXml(k)}</key>\n      <string>${escapeXml(v)}</string>`)
        .join('\n');

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    ${programArgs.map((a) => `<string>${escapeXml(a)}</string>`).join('\n    ')}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envDict}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logDir)}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logDir)}/stderr.log</string>
</dict>
</plist>`;

      await mkdir(plistDir, { recursive: true });
      await mkdir(logDir, { recursive: true });
      await writeFile(plistPath, plist, 'utf-8');
      logger.info('[service] LaunchAgent plist written', { path: plistPath });

      await execFileAsync('launchctl', ['load', '-w', plistPath]);
      logger.info('[service] LaunchAgent loaded');
    },

    async uninstall(): Promise<void> {
      try {
        await execFileAsync('launchctl', ['unload', plistPath]);
        logger.info('[service] LaunchAgent unloaded');
      } catch {
        // may not be loaded — ignore
      }
      if (await fileExists(plistPath)) {
        await unlink(plistPath);
        logger.info('[service] LaunchAgent plist removed');
      }
    },

    async status(): Promise<ServiceStatus> {
      try {
        const { stdout } = await execFileAsync('launchctl', ['list', PLIST_NAME]);
        const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/);
        const running = pidMatch !== null && parseInt(pidMatch[1], 10) > 0;
        return { running, platform: 'darwin', details: stdout };
      } catch (err) {
        return {
          running: false,
          platform: 'darwin',
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ─── Linux systemd ────────────────────────────────────────────────────────────

function createLinuxServiceManager(workingDir: string): ServiceManager {
  const serviceDir = resolve(homedir(), '.config/systemd/user');
  const servicePath = resolve(serviceDir, `${SERVICE_NAME}.service`);

  return {
    async install(options: InstallOptions): Promise<void> {
      let envVars: Record<string, string> = {};
      if (options.envFile) {
        envVars = await parseEnvFile(options.envFile);
      }
      if (options.envOverrides) {
        envVars = { ...envVars, ...options.envOverrides };
      }

      const execStart = [options.executablePath, ...(options.args ?? [])].join(' ');
      const envLines = Object.entries(envVars)
        .map(([k, v]) => `Environment=${k}=${v}`)
        .join('\n');

      const unit = `[Unit]
Description=Pyrfor Runtime
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${workingDir}
${envLines ? envLines + '\n' : ''}Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;

      await mkdir(serviceDir, { recursive: true });
      await writeFile(servicePath, unit, 'utf-8');
      logger.info('[service] systemd unit written', { path: servicePath });

      await execFileAsync('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);
      logger.info('[service] systemd unit enabled');
    },

    async uninstall(): Promise<void> {
      try {
        await execFileAsync('systemctl', ['--user', 'disable', '--now', SERVICE_NAME]);
        logger.info('[service] systemd unit disabled');
      } catch {
        // may not be running — ignore
      }
      if (await fileExists(servicePath)) {
        await unlink(servicePath);
        logger.info('[service] systemd unit removed');
      }
    },

    async status(): Promise<ServiceStatus> {
      try {
        const { stdout } = await execFileAsync('systemctl', ['--user', 'is-active', SERVICE_NAME]);
        const active = stdout.trim() === 'active';
        return { running: active, platform: 'linux', details: stdout.trim() };
      } catch (err: unknown) {
        const errWithOut = err as { stdout?: string };
        const output = errWithOut.stdout?.trim() ?? '';
        return {
          running: false,
          platform: 'linux',
          details: output || (err instanceof Error ? err.message : String(err)),
        };
      }
    },
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createServiceManager(opts?: { workingDir?: string }): ServiceManager {
  const workingDir = opts?.workingDir ?? getEngineRoot();
  const plat = process.platform;

  if (plat === 'darwin') return createDarwinServiceManager(workingDir);
  if (plat === 'linux') return createLinuxServiceManager(workingDir);

  throw new Error(`[service] Platform '${plat}' is not supported. Supported: darwin, linux.`);
}
