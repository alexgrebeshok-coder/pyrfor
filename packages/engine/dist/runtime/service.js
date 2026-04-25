/**
 * Runtime Service Manager — OS-level process supervision.
 *
 * Supports:
 *   - macOS:  LaunchAgent  (launchctl)      ~/Library/LaunchAgents/dev.pyrfor.runtime.plist
 *   - Linux:  systemd user unit             ~/.config/systemd/user/pyrfor-runtime.service
 *
 * Ported from daemon/service.ts; async-first, ESM-native, no execSync.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as _execFile } from 'node:child_process';
import { writeFile, readFile, unlink, mkdir, access } from 'node:fs/promises';
import { logger } from '../observability/logger.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const PLIST_NAME = 'dev.pyrfor.runtime';
const SERVICE_NAME = 'pyrfor-runtime';
// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function fileExists(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield access(filePath);
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
function parseEnvFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const content = yield readFile(filePath, 'utf-8');
        const result = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 1)
                continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
        return result;
    });
}
/** Thin async wrapper so tests can mock node:child_process execFile via callback interception. */
function execFileAsync(file, args) {
    return new Promise((res, rej) => {
        _execFile(file, args, (err, stdout, stderr) => {
            if (err) {
                const enriched = err;
                enriched.stdout = typeof stdout === 'string' ? stdout : '';
                enriched.stderr = typeof stderr === 'string' ? stderr : '';
                rej(enriched);
            }
            else {
                res({
                    stdout: String(stdout),
                    stderr: String(stderr),
                });
            }
        });
    });
}
function getEngineRoot() {
    // service.ts lives at packages/engine/src/runtime/ — go up 2 dirs to reach packages/engine
    const __filename = fileURLToPath(import.meta.url);
    return resolve(dirname(__filename), '..', '..');
}
// ─── macOS LaunchAgent ────────────────────────────────────────────────────────
function createDarwinServiceManager(workingDir) {
    const plistDir = resolve(homedir(), 'Library/LaunchAgents');
    const plistPath = resolve(plistDir, `${PLIST_NAME}.plist`);
    const logDir = resolve(homedir(), 'Library/Logs/pyrfor-runtime');
    return {
        install(options) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                let envVars = {};
                if (options.envFile) {
                    envVars = yield parseEnvFile(options.envFile);
                }
                if (options.envOverrides) {
                    envVars = Object.assign(Object.assign({}, envVars), options.envOverrides);
                }
                const programArgs = [options.executablePath, ...((_a = options.args) !== null && _a !== void 0 ? _a : [])];
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
                yield mkdir(plistDir, { recursive: true });
                yield mkdir(logDir, { recursive: true });
                yield writeFile(plistPath, plist, 'utf-8');
                logger.info('[service] LaunchAgent plist written', { path: plistPath });
                yield execFileAsync('launchctl', ['load', '-w', plistPath]);
                logger.info('[service] LaunchAgent loaded');
            });
        },
        uninstall() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield execFileAsync('launchctl', ['unload', plistPath]);
                    logger.info('[service] LaunchAgent unloaded');
                }
                catch (_a) {
                    // may not be loaded — ignore
                }
                if (yield fileExists(plistPath)) {
                    yield unlink(plistPath);
                    logger.info('[service] LaunchAgent plist removed');
                }
            });
        },
        status() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const { stdout } = yield execFileAsync('launchctl', ['list', PLIST_NAME]);
                    const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/);
                    const running = pidMatch !== null && parseInt(pidMatch[1], 10) > 0;
                    return { running, platform: 'darwin', details: stdout };
                }
                catch (err) {
                    return {
                        running: false,
                        platform: 'darwin',
                        details: err instanceof Error ? err.message : String(err),
                    };
                }
            });
        },
    };
}
// ─── Linux systemd ────────────────────────────────────────────────────────────
function createLinuxServiceManager(workingDir) {
    const serviceDir = resolve(homedir(), '.config/systemd/user');
    const servicePath = resolve(serviceDir, `${SERVICE_NAME}.service`);
    return {
        install(options) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                let envVars = {};
                if (options.envFile) {
                    envVars = yield parseEnvFile(options.envFile);
                }
                if (options.envOverrides) {
                    envVars = Object.assign(Object.assign({}, envVars), options.envOverrides);
                }
                const execStart = [options.executablePath, ...((_a = options.args) !== null && _a !== void 0 ? _a : [])].join(' ');
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
                yield mkdir(serviceDir, { recursive: true });
                yield writeFile(servicePath, unit, 'utf-8');
                logger.info('[service] systemd unit written', { path: servicePath });
                yield execFileAsync('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);
                logger.info('[service] systemd unit enabled');
            });
        },
        uninstall() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield execFileAsync('systemctl', ['--user', 'disable', '--now', SERVICE_NAME]);
                    logger.info('[service] systemd unit disabled');
                }
                catch (_a) {
                    // may not be running — ignore
                }
                if (yield fileExists(servicePath)) {
                    yield unlink(servicePath);
                    logger.info('[service] systemd unit removed');
                }
            });
        },
        status() {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                try {
                    const { stdout } = yield execFileAsync('systemctl', ['--user', 'is-active', SERVICE_NAME]);
                    const active = stdout.trim() === 'active';
                    return { running: active, platform: 'linux', details: stdout.trim() };
                }
                catch (err) {
                    const errWithOut = err;
                    const output = (_b = (_a = errWithOut.stdout) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '';
                    return {
                        running: false,
                        platform: 'linux',
                        details: output || (err instanceof Error ? err.message : String(err)),
                    };
                }
            });
        },
    };
}
// ─── Factory ──────────────────────────────────────────────────────────────────
export function createServiceManager(opts) {
    var _a;
    const workingDir = (_a = opts === null || opts === void 0 ? void 0 : opts.workingDir) !== null && _a !== void 0 ? _a : getEngineRoot();
    const plat = process.platform;
    if (plat === 'darwin')
        return createDarwinServiceManager(workingDir);
    if (plat === 'linux')
        return createLinuxServiceManager(workingDir);
    throw new Error(`[service] Platform '${plat}' is not supported. Supported: darwin, linux.`);
}
