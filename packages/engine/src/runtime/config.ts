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

import { z } from 'zod';
import { promises as fsp, watch as fsWatch } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../observability/logger';

// ─── Paths ──────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.pyrfor', 'runtime.json');
export const LEGACY_CONFIG_PATH = path.join(os.homedir(), '.ceoclaw', 'ceoclaw.json');

// ─── Schema ─────────────────────────────────────────────────────────────────

export const RuntimeConfigSchema = z.object({
  workspacePath: z.string().optional(),
  memoryPath: z.string().optional(),
  /** Absolute path to the IDE workspace root served by /api/fs/* endpoints. */
  workspaceRoot: z.string().optional(),
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
  }).default(() => ({ enabled: true, provider: 'local' as const, model: 'whisper-1', language: 'auto' })),
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
    intervalMs: z.number().int().positive().default(30_000),
  }).default(() => ({ enabled: true, intervalMs: 30_000 })),
  gateway: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().default(18790),
    bearerToken: z.string().optional(),
    bearerTokens: z.array(z.object({
      value: z.string().min(8),
      expiresAt: z.string().datetime().optional(),
      label: z.string().optional(),
    })).default([]),
  }).default(() => ({ enabled: true, host: '127.0.0.1', port: 18790, bearerTokens: [] })),
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

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

// ─── Error ───────────────────────────────────────────────────────────────────

export class RuntimeConfigError extends Error {
  issues?: z.ZodIssue[];

  constructor(message: string, issues?: z.ZodIssue[]) {
    super(message);
    this.name = 'RuntimeConfigError';
    this.issues = issues;
  }
}

// ─── Env Overrides ───────────────────────────────────────────────────────────

/**
 * Apply environment variable overrides. PYRFOR_* takes priority over legacy names.
 */
export function applyEnvOverrides(cfg: RuntimeConfig): RuntimeConfig {
  const e = process.env;
  // Deep-clone top-level to avoid mutating the original
  const result: RuntimeConfig = {
    ...cfg,
    telegram: { ...cfg.telegram },
    voice: { ...cfg.voice },
    gateway: { ...cfg.gateway },
    rateLimit: { ...cfg.rateLimit, exemptPaths: [...cfg.rateLimit.exemptPaths] },
    cron: { ...cfg.cron },
    health: { ...cfg.health },
    providers: { ...cfg.providers },
    persistence: { ...cfg.persistence, prisma: { ...cfg.persistence.prisma } },
  };

  // workspacePath
  const workspace = e['PYRFOR_WORKSPACE'];
  if (workspace) result.workspacePath = workspace;

  // telegram.botToken — PYRFOR_TELEGRAM_BOT_TOKEN wins over TELEGRAM_BOT_TOKEN
  const botToken = e['PYRFOR_TELEGRAM_BOT_TOKEN'] ?? e['TELEGRAM_BOT_TOKEN'];
  if (botToken) result.telegram.botToken = botToken;

  // telegram.allowedChatIds — CSV, e.g. "123,456"
  const allowedChatIds = e['PYRFOR_TELEGRAM_ALLOWED_CHAT_IDS'] ?? e['TELEGRAM_ALLOWED_CHAT_IDS'];
  if (allowedChatIds) {
    result.telegram.allowedChatIds = allowedChatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (isNaN(Number(s)) ? s : Number(s)));
  }

  // voice.openaiApiKey — only when provider=openai
  const openaiKey = e['PYRFOR_OPENAI_API_KEY'] ?? e['OPENAI_API_KEY'];
  if (openaiKey) result.voice.openaiApiKey = openaiKey;

  // gateway.port
  const gwPort = e['PYRFOR_GATEWAY_PORT'];
  if (gwPort) {
    const p = parseInt(gwPort, 10);
    if (!isNaN(p) && p > 0) result.gateway.port = p;
  }

  // gateway.bearerToken
  const gwToken = e['PYRFOR_GATEWAY_TOKEN'];
  if (gwToken) result.gateway.bearerToken = gwToken;

  return result;
}

// ─── Load ────────────────────────────────────────────────────────────────────

export async function loadConfig(
  filePath?: string,
): Promise<{ config: RuntimeConfig; path: string; loadedFromLegacy: boolean }> {
  // Honour PYRFOR_CONFIG_PATH env override
  const envPath = process.env['PYRFOR_CONFIG_PATH'];
  const resolvedPath = filePath ?? envPath ?? DEFAULT_CONFIG_PATH;

  let raw: string | undefined;
  let loadedFromLegacy = false;

  try {
    raw = await fsp.readFile(resolvedPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Try legacy path only when primary is the default
      if (resolvedPath === DEFAULT_CONFIG_PATH) {
        try {
          raw = await fsp.readFile(LEGACY_CONFIG_PATH, 'utf-8');
          loadedFromLegacy = true;
          logger.debug('RuntimeConfig: loaded from legacy path', { path: LEGACY_CONFIG_PATH });
        } catch {
          // Return defaults when neither file exists
          const config = applyEnvOverrides(RuntimeConfigSchema.parse({}));
          return { config, path: resolvedPath, loadedFromLegacy: false };
        }
      } else {
        // Custom path explicitly given but missing — return defaults
        const config = applyEnvOverrides(RuntimeConfigSchema.parse({}));
        return { config, path: resolvedPath, loadedFromLegacy: false };
      }
    } else {
      throw err;
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new RuntimeConfigError(`Failed to parse config JSON at ${resolvedPath}: ${(err as Error).message}`);
  }

  const result = RuntimeConfigSchema.safeParse(json);
  if (!result.success) {
    throw new RuntimeConfigError(
      `Config validation failed at ${resolvedPath}`,
      result.error.issues,
    );
  }

  const config = applyEnvOverrides(result.data);
  return { config, path: resolvedPath, loadedFromLegacy };
}

// ─── Save ────────────────────────────────────────────────────────────────────

let _saveSeq = 0;

/**
 * Atomic write: tmp file → fsync → rename. Creates parent directory.
 */
export async function saveConfig(cfg: RuntimeConfig, filePath?: string): Promise<void> {
  const envPath = process.env['PYRFOR_CONFIG_PATH'];
  const dest = filePath ?? envPath ?? DEFAULT_CONFIG_PATH;

  await fsp.mkdir(path.dirname(dest), { recursive: true });

  // Unique per-call sequence prevents tmp-path collision on concurrent saves.
  const tmpPath = `${dest}.${process.pid}.${++_saveSeq}.tmp`;
  const json = JSON.stringify({ ...cfg, _schemaVersion: SCHEMA_VERSION }, null, 2);

  let fh: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    fh = await fsp.open(tmpPath, 'w', 0o600);
    await fh.writeFile(json, 'utf-8');
    await fh.sync().catch(() => { /* fsync failure is not fatal */ });
  } finally {
    await fh?.close();
  }
  await fsp.rename(tmpPath, dest);
  logger.debug('RuntimeConfig: saved', { path: dest, bytes: json.length });
}

// ─── Watch ───────────────────────────────────────────────────────────────────

/**
 * Watch config file with debounce. Returns a dispose() function that stops watching.
 * Uses fs.watch (event-driven via kqueue/inotify) for low-latency hot-reload.
 */
export function watchConfig(
  filePath: string,
  onChange: (next: RuntimeConfig, prev: RuntimeConfig) => void,
  options?: { debounceMs?: number; onError?: (err: unknown) => void },
): () => void {
  const debounceMs = options?.debounceMs ?? 500;
  const onError = options?.onError;

  let current: RuntimeConfig | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let watcher: ReturnType<typeof fsWatch> | undefined;

  // Load initial snapshot asynchronously
  loadConfig(filePath).then(({ config }) => {
    current = config;
  }).catch((err) => {
    onError?.(err);
  });

  const reload = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (disposed) return;
      try {
        const { config: next } = await loadConfig(filePath);
        const prev = current ?? next;
        current = next;
        onChange(next, prev);
      } catch (err) {
        logger.warn('RuntimeConfig: reload failed', { path: filePath, err });
        onError?.(err);
      }
    }, debounceMs);
  };

  try {
    watcher = fsWatch(filePath, { persistent: false }, (_event) => {
      reload();
    });
    watcher.on('error', (err) => {
      logger.warn('RuntimeConfig watcher error', { path: filePath, err });
      onError?.(err);
    });
  } catch (err) {
    // File might not exist yet; swallow and let caller handle
    logger.warn('RuntimeConfig: could not watch path', { path: filePath, err });
    onError?.(err);
  }

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    try { watcher?.close(); } catch { /* ignore */ }
  };
}
