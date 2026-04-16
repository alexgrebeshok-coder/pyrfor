/**
 * CEOClaw Daemon — Configuration System
 *
 * JSON config with Zod validation, env overrides, hot-reload.
 * Inspired by OpenClaw's config system, improved with strict types.
 */

import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

// ─── Schema ────────────────────────────────────────────────────────────────

const TelegramConfigSchema = z.object({
  token: z.string().optional(),
  mode: z.enum(["polling", "webhook"]).default("polling"),
  allowedChatIds: z.array(z.number()).default([]),
  adminChatIds: z.array(z.number()).default([]),
  pollingTimeout: z.number().min(1).max(60).default(30),
  rateLimitPerMinute: z.number().min(1).max(120).default(30),
});

const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  enabled: z.boolean().default(true),
  handler: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
});

const AIProviderSchema = z.object({
  name: z.string(),
  baseURL: z.string().url(),
  apiKeyEnvVar: z.string().optional(),
  defaultModel: z.string(),
  models: z.array(z.string()).default([]),
});

const AuthConfigSchema = z.object({
  mode: z.enum(["token", "none"]).default("token"),
  token: z.string().optional(),
});

const GatewayConfigSchema = z.object({
  port: z.number().min(1024).max(65535).default(18790),
  bind: z.enum(["loopback", "lan", "all"]).default("loopback"),
  auth: AuthConfigSchema.optional().default({ mode: "token" }),
});

const HybridSearchWeightSchema = z.object({
  vector: z.number().min(0).max(1).default(0.7),
  keyword: z.number().min(0).max(1).default(0.3),
});

const MemoryConfigSchema = z.object({
  embeddingsProvider: z.enum(["openai", "local", "none"]).default("none"),
  embeddingsModel: z.string().default("text-embedding-3-small"),
  vectorDimensions: z.number().default(1536),
  hybridSearchWeight: HybridSearchWeightSchema.optional().default({ vector: 0.7, keyword: 0.3 }),
  syncIntervalMs: z.number().min(5000).default(60000),
});

const TranscriptionConfigSchema = z.object({
  provider: z.enum(["whisper-api", "whisper-local", "none"]).default("whisper-api"),
  model: z.string().default("whisper-1"),
  language: z.string().default("ru"),
  timeoutSeconds: z.number().min(5).max(120).default(45),
});

const TtsConfigSchema = z.object({
  provider: z.enum(["edge-tts", "openai-tts", "none"]).default("edge-tts"),
  voice: z.string().default("ru-RU-DmitryNeural"),
});

const VoiceConfigSchema = z.object({
  transcription: TranscriptionConfigSchema.optional().default({ provider: "whisper-api", model: "whisper-1", language: "ru", timeoutSeconds: 45 }),
  tts: TtsConfigSchema.optional().default({ provider: "edge-tts", voice: "ru-RU-DmitryNeural" }),
});

export const HealthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().min(5000).default(30000),
  restartOnFailure: z.boolean().default(true),
  maxRestarts: z.number().min(0).default(5),
  restartWindowMs: z.number().default(300000),
});

export const DaemonConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  gateway: GatewayConfigSchema.optional(),
  telegram: TelegramConfigSchema.optional(),
  cron: z.object({
    enabled: z.boolean().default(true),
    jobs: z.array(CronJobSchema).default([]),
  }).optional(),
  ai: z.object({
    providers: z.array(AIProviderSchema).default([]),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
  }).optional(),
  memory: MemoryConfigSchema.optional(),
  voice: VoiceConfigSchema.optional(),
  health: HealthConfigSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// Zod v4 doesn't deep-apply nested defaults. Re-parse sub-schemas explicitly.
function deepApplyDefaults(raw: z.infer<typeof DaemonConfigSchema>): DaemonConfig {
  return {
    version: raw.version,
    gateway: GatewayConfigSchema.parse(raw.gateway ?? {}),
    telegram: TelegramConfigSchema.parse(raw.telegram ?? {}),
    cron: {
      enabled: raw.cron?.enabled ?? true,
      jobs: (raw.cron?.jobs ?? []).map((j) => CronJobSchema.parse(j)),
    },
    ai: {
      providers: (raw.ai?.providers ?? []).map((p) => AIProviderSchema.parse(p)),
      defaultProvider: raw.ai?.defaultProvider,
      defaultModel: raw.ai?.defaultModel,
    },
    memory: MemoryConfigSchema.parse(raw.memory ?? {}),
    voice: VoiceConfigSchema.parse(raw.voice ?? {}),
    health: HealthConfigSchema.parse(raw.health ?? {}),
    env: raw.env ?? {},
  };
}

// Explicit type — all sub-objects guaranteed present after deepApplyDefaults
export interface DaemonConfig {
  version: string;
  gateway: z.infer<typeof GatewayConfigSchema>;
  telegram: z.infer<typeof TelegramConfigSchema>;
  cron: { enabled: boolean; jobs: z.infer<typeof CronJobSchema>[] };
  ai: {
    providers: z.infer<typeof AIProviderSchema>[];
    defaultProvider?: string;
    defaultModel?: string;
  };
  memory: z.infer<typeof MemoryConfigSchema>;
  voice: z.infer<typeof VoiceConfigSchema>;
  health: z.infer<typeof HealthConfigSchema>;
  env: Record<string, string>;
}

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type CronJobConfig = z.infer<typeof CronJobSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;

// ─── Config Paths ──────────────────────────────────────────────────────────

export function getConfigDir(): string {
  return resolve(homedir(), ".ceoclaw");
}

export function getConfigPath(): string {
  return resolve(getConfigDir(), "ceoclaw.json");
}

// ─── Config I/O ────────────────────────────────────────────────────────────

export function loadConfig(path?: string): DaemonConfig {
  const configPath = path ?? getConfigPath();

  if (!existsSync(configPath)) {
    return createDefaultConfig(configPath);
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const validated = DaemonConfigSchema.parse(parsed);
    const config = deepApplyDefaults(validated);

    // Apply env overrides
    return applyEnvOverrides(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Config validation failed:", error.issues);
      console.error("Using defaults for invalid fields");
      return applyEnvOverrides(deepApplyDefaults(DaemonConfigSchema.parse({})));
    }
    throw error;
  }
}

export function saveConfig(config: DaemonConfig, path?: string): void {
  const configPath = path ?? getConfigPath();
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function createDefaultConfig(configPath: string): DaemonConfig {
  const validated = DaemonConfigSchema.parse({
    cron: {
      jobs: [
        {
          id: "morning-brief",
          name: "Morning Briefing",
          schedule: "30 7 * * 1-5",
          handler: "morning-brief",
          enabled: false,
        },
        {
          id: "email-digest",
          name: "Weekly Email Digest",
          schedule: "0 9 * * 1",
          handler: "email-digest",
          enabled: false,
        },
        {
          id: "agent-heartbeat",
          name: "Agent Heartbeat Scheduler",
          schedule: "*/2 * * * *",
          handler: "agent-heartbeat",
          enabled: true,
          config: { batchSize: 5, gatewayPort: 3000 },
        },
        {
          id: "budget-reset",
          name: "Monthly Budget Reset",
          schedule: "0 0 1 * *",
          handler: "budget-reset",
          enabled: true,
        },
      ],
    },
  });
  const config = deepApplyDefaults(validated);

  saveConfig(config, configPath);
  return applyEnvOverrides(config);
}

// ─── Env Overrides ─────────────────────────────────────────────────────────

function applyEnvOverrides(config: DaemonConfig): DaemonConfig {
  const env = process.env;
  const result = { ...config };

  // Telegram token from env
  if (env.TELEGRAM_BOT_TOKEN && !result.telegram.token) {
    result.telegram = { ...result.telegram, token: env.TELEGRAM_BOT_TOKEN };
  }

  // Gateway port from env
  if (env.CEOCLAW_DAEMON_PORT) {
    const port = parseInt(env.CEOCLAW_DAEMON_PORT, 10);
    if (port >= 1024 && port <= 65535) {
      result.gateway = { ...result.gateway, port };
    }
  }

  // Gateway auth token from env
  if (env.CEOCLAW_DAEMON_TOKEN) {
    result.gateway = {
      ...result.gateway,
      auth: { ...result.gateway.auth, token: env.CEOCLAW_DAEMON_TOKEN },
    };
  }

  // Apply config.env to process.env
  for (const [key, value] of Object.entries(config.env)) {
    if (!env[key]) {
      process.env[key] = value;
    }
  }

  return result;
}

// ─── Config Watcher (hot-reload) ───────────────────────────────────────────

export type ConfigChangeHandler = (
  newConfig: DaemonConfig,
  oldConfig: DaemonConfig
) => void;

export class ConfigWatcher {
  private path: string;
  private current: DaemonConfig;
  private handlers: ConfigChangeHandler[] = [];
  private watching = false;

  constructor(config: DaemonConfig, path?: string) {
    this.path = path ?? getConfigPath();
    this.current = config;
  }

  get config(): DaemonConfig {
    return this.current;
  }

  onChange(handler: ConfigChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  start(): void {
    if (this.watching) return;
    this.watching = true;

    watchFile(this.path, { interval: 2000 }, () => {
      try {
        const newConfig = loadConfig(this.path);
        const old = this.current;
        this.current = newConfig;

        for (const handler of this.handlers) {
          try {
            handler(newConfig, old);
          } catch (err) {
            console.error("Config change handler error:", err);
          }
        }
      } catch (err) {
        console.error("Config reload failed:", err);
      }
    });
  }

  stop(): void {
    if (!this.watching) return;
    this.watching = false;
    unwatchFile(this.path);
  }
}
