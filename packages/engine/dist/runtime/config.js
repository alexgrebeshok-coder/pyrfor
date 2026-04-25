// @ts-nocheck-off
/**
 * RuntimeConfig — persistent JSON config for Pyrfor runtime.
 *
 * Features:
 * - Zod-validated schema with nested defaults
 * - loadConfig: reads ~/.pyrfor/runtime.json (or legacy ~/.ceoclaw/ceoclaw.json)
 * - saveConfig: atomic write (tmp + rename)
 * - watchConfig: fs.watchFile with debounce, hot-reload with validation
 * - applyEnvOverrides: PYRFOR_* and legacy env vars
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
import { z } from 'zod';
import { promises as fsp, watch as fsWatch } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../observability/logger.js';
// ─── Paths ──────────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = 1;
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.pyrfor', 'runtime.json');
export const LEGACY_CONFIG_PATH = path.join(os.homedir(), '.ceoclaw', 'ceoclaw.json');
// ─── Schema ─────────────────────────────────────────────────────────────────
export const RuntimeConfigSchema = z.object({
    workspacePath: z.string().optional(),
    memoryPath: z.string().optional(),
    telegram: z.object({
        enabled: z.boolean().default(false),
        botToken: z.string().optional(),
        allowedChatIds: z.array(z.union([z.number(), z.string()])).default([]),
        rateLimitPerMinute: z.number().int().positive().default(30),
    }).default(() => ({ enabled: false, allowedChatIds: [], rateLimitPerMinute: 30 })),
    voice: z.object({
        enabled: z.boolean().default(true),
        provider: z.enum(['local', 'openai']).default('local'),
        whisperBinary: z.string().optional(),
        openaiApiKey: z.string().optional(),
        model: z.string().default('whisper-1'),
        language: z.string().default('auto'),
    }).default(() => ({ enabled: true, provider: 'local', model: 'whisper-1', language: 'auto' })),
    cron: z.object({
        enabled: z.boolean().default(true),
        timezone: z.string().default('UTC'),
        jobs: z.array(z.object({
            name: z.string(),
            schedule: z.string(),
            handler: z.string(),
            enabled: z.boolean().default(true),
            timezone: z.string().optional(),
        })).default([]),
    }).default(() => ({ enabled: true, timezone: 'UTC', jobs: [] })),
    health: z.object({
        enabled: z.boolean().default(true),
        intervalMs: z.number().int().positive().default(30000),
    }).default(() => ({ enabled: true, intervalMs: 30000 })),
    gateway: z.object({
        enabled: z.boolean().default(false),
        host: z.string().default('127.0.0.1'),
        port: z.number().int().positive().default(18790),
        bearerToken: z.string().optional(),
        bearerTokens: z.array(z.object({
            value: z.string().min(8),
            expiresAt: z.string().datetime().optional(),
            label: z.string().optional(),
        })).default([]),
    }).default(() => ({ enabled: false, host: '127.0.0.1', port: 18790, bearerTokens: [] })),
    rateLimit: z.object({
        enabled: z.boolean().default(false),
        capacity: z.number().int().positive().default(60),
        refillPerSec: z.number().positive().default(1),
        exemptPaths: z.array(z.string()).default(['/ping', '/health', '/metrics']),
    }).default(() => ({ enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: ['/ping', '/health', '/metrics'] })),
    providers: z.object({
        defaultProvider: z.string().optional(),
        enableFallback: z.boolean().default(true),
    }).default(() => ({ enableFallback: true })),
    persistence: z.object({
        enabled: z.boolean().default(true),
        rootDir: z.string().optional(),
        debounceMs: z.number().int().positive().default(5000),
        prisma: z.object({
            enabled: z.boolean().default(false),
        }).default(() => ({ enabled: false })),
    }).default(() => ({ enabled: true, debounceMs: 5000, prisma: { enabled: false } })),
});
// ─── Error ───────────────────────────────────────────────────────────────────
export class RuntimeConfigError extends Error {
    constructor(message, issues) {
        super(message);
        this.name = 'RuntimeConfigError';
        this.issues = issues;
    }
}
// ─── Env Overrides ───────────────────────────────────────────────────────────
/**
 * Apply environment variable overrides. PYRFOR_* takes priority over legacy names.
 */
export function applyEnvOverrides(cfg) {
    var _a, _b, _c;
    const e = process.env;
    // Deep-clone top-level to avoid mutating the original
    const result = Object.assign(Object.assign({}, cfg), { telegram: Object.assign({}, cfg.telegram), voice: Object.assign({}, cfg.voice), gateway: Object.assign({}, cfg.gateway), rateLimit: Object.assign(Object.assign({}, cfg.rateLimit), { exemptPaths: [...cfg.rateLimit.exemptPaths] }), cron: Object.assign({}, cfg.cron), health: Object.assign({}, cfg.health), providers: Object.assign({}, cfg.providers), persistence: Object.assign(Object.assign({}, cfg.persistence), { prisma: Object.assign({}, cfg.persistence.prisma) }) });
    // workspacePath
    const workspace = e['PYRFOR_WORKSPACE'];
    if (workspace)
        result.workspacePath = workspace;
    // telegram.botToken — PYRFOR_TELEGRAM_BOT_TOKEN wins over TELEGRAM_BOT_TOKEN
    const botToken = (_a = e['PYRFOR_TELEGRAM_BOT_TOKEN']) !== null && _a !== void 0 ? _a : e['TELEGRAM_BOT_TOKEN'];
    if (botToken)
        result.telegram.botToken = botToken;
    // telegram.allowedChatIds — CSV, e.g. "123,456"
    const allowedChatIds = (_b = e['PYRFOR_TELEGRAM_ALLOWED_CHAT_IDS']) !== null && _b !== void 0 ? _b : e['TELEGRAM_ALLOWED_CHAT_IDS'];
    if (allowedChatIds) {
        result.telegram.allowedChatIds = allowedChatIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => (isNaN(Number(s)) ? s : Number(s)));
    }
    // voice.openaiApiKey — only when provider=openai
    const openaiKey = (_c = e['PYRFOR_OPENAI_API_KEY']) !== null && _c !== void 0 ? _c : e['OPENAI_API_KEY'];
    if (openaiKey)
        result.voice.openaiApiKey = openaiKey;
    // gateway.port
    const gwPort = e['PYRFOR_GATEWAY_PORT'];
    if (gwPort) {
        const p = parseInt(gwPort, 10);
        if (!isNaN(p) && p > 0)
            result.gateway.port = p;
    }
    // gateway.bearerToken
    const gwToken = e['PYRFOR_GATEWAY_TOKEN'];
    if (gwToken)
        result.gateway.bearerToken = gwToken;
    return result;
}
// ─── Load ────────────────────────────────────────────────────────────────────
export function loadConfig(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Honour PYRFOR_CONFIG_PATH env override
        const envPath = process.env['PYRFOR_CONFIG_PATH'];
        const resolvedPath = (_a = filePath !== null && filePath !== void 0 ? filePath : envPath) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG_PATH;
        let raw;
        let loadedFromLegacy = false;
        try {
            raw = yield fsp.readFile(resolvedPath, 'utf-8');
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                // Try legacy path only when primary is the default
                if (resolvedPath === DEFAULT_CONFIG_PATH) {
                    try {
                        raw = yield fsp.readFile(LEGACY_CONFIG_PATH, 'utf-8');
                        loadedFromLegacy = true;
                        logger.debug('RuntimeConfig: loaded from legacy path', { path: LEGACY_CONFIG_PATH });
                    }
                    catch (_b) {
                        // Return defaults when neither file exists
                        const config = applyEnvOverrides(RuntimeConfigSchema.parse({}));
                        return { config, path: resolvedPath, loadedFromLegacy: false };
                    }
                }
                else {
                    // Custom path explicitly given but missing — return defaults
                    const config = applyEnvOverrides(RuntimeConfigSchema.parse({}));
                    return { config, path: resolvedPath, loadedFromLegacy: false };
                }
            }
            else {
                throw err;
            }
        }
        let json;
        try {
            json = JSON.parse(raw);
        }
        catch (err) {
            throw new RuntimeConfigError(`Failed to parse config JSON at ${resolvedPath}: ${err.message}`);
        }
        const result = RuntimeConfigSchema.safeParse(json);
        if (!result.success) {
            throw new RuntimeConfigError(`Config validation failed at ${resolvedPath}`, result.error.issues);
        }
        const config = applyEnvOverrides(result.data);
        return { config, path: resolvedPath, loadedFromLegacy };
    });
}
// ─── Save ────────────────────────────────────────────────────────────────────
let _saveSeq = 0;
/**
 * Atomic write: tmp file → fsync → rename. Creates parent directory.
 */
export function saveConfig(cfg, filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const envPath = process.env['PYRFOR_CONFIG_PATH'];
        const dest = (_a = filePath !== null && filePath !== void 0 ? filePath : envPath) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG_PATH;
        yield fsp.mkdir(path.dirname(dest), { recursive: true });
        // Unique per-call sequence prevents tmp-path collision on concurrent saves.
        const tmpPath = `${dest}.${process.pid}.${++_saveSeq}.tmp`;
        const json = JSON.stringify(Object.assign(Object.assign({}, cfg), { _schemaVersion: SCHEMA_VERSION }), null, 2);
        let fh;
        try {
            fh = yield fsp.open(tmpPath, 'w', 0o600);
            yield fh.writeFile(json, 'utf-8');
            yield fh.sync().catch(() => { });
        }
        finally {
            yield (fh === null || fh === void 0 ? void 0 : fh.close());
        }
        yield fsp.rename(tmpPath, dest);
        logger.debug('RuntimeConfig: saved', { path: dest, bytes: json.length });
    });
}
// ─── Watch ───────────────────────────────────────────────────────────────────
/**
 * Watch config file with debounce. Returns a dispose() function that stops watching.
 * Uses fs.watch (event-driven via kqueue/inotify) for low-latency hot-reload.
 */
export function watchConfig(filePath, onChange, options) {
    var _a;
    const debounceMs = (_a = options === null || options === void 0 ? void 0 : options.debounceMs) !== null && _a !== void 0 ? _a : 500;
    const onError = options === null || options === void 0 ? void 0 : options.onError;
    let current;
    let timer;
    let disposed = false;
    let watcher;
    // Load initial snapshot asynchronously
    loadConfig(filePath).then(({ config }) => {
        current = config;
    }).catch((err) => {
        onError === null || onError === void 0 ? void 0 : onError(err);
    });
    const reload = () => {
        if (disposed)
            return;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            if (disposed)
                return;
            try {
                const { config: next } = yield loadConfig(filePath);
                const prev = current !== null && current !== void 0 ? current : next;
                current = next;
                onChange(next, prev);
            }
            catch (err) {
                logger.warn('RuntimeConfig: reload failed', { path: filePath, err });
                onError === null || onError === void 0 ? void 0 : onError(err);
            }
        }), debounceMs);
    };
    try {
        watcher = fsWatch(filePath, { persistent: false }, (_event) => {
            reload();
        });
        watcher.on('error', (err) => {
            logger.warn('RuntimeConfig watcher error', { path: filePath, err });
            onError === null || onError === void 0 ? void 0 : onError(err);
        });
    }
    catch (err) {
        // File might not exist yet; swallow and let caller handle
        logger.warn('RuntimeConfig: could not watch path', { path: filePath, err });
        onError === null || onError === void 0 ? void 0 : onError(err);
    }
    return () => {
        disposed = true;
        if (timer)
            clearTimeout(timer);
        try {
            watcher === null || watcher === void 0 ? void 0 : watcher.close();
        }
        catch ( /* ignore */_a) { /* ignore */ }
    };
}
