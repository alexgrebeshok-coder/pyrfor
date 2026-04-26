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
export declare const SCHEMA_VERSION = 1;
export declare const DEFAULT_CONFIG_PATH: string;
export declare const LEGACY_CONFIG_PATH: string;
export declare const RuntimeConfigSchema: z.ZodObject<{
    workspacePath: z.ZodOptional<z.ZodString>;
    memoryPath: z.ZodOptional<z.ZodString>;
    workspaceRoot: z.ZodOptional<z.ZodString>;
    telegram: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        botToken: z.ZodOptional<z.ZodString>;
        allowedChatIds: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        rateLimitPerMinute: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    voice: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        provider: z.ZodDefault<z.ZodEnum<{
            local: "local";
            openai: "openai";
        }>>;
        whisperBinary: z.ZodOptional<z.ZodString>;
        openaiApiKey: z.ZodOptional<z.ZodString>;
        model: z.ZodDefault<z.ZodString>;
        language: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    cron: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timezone: z.ZodDefault<z.ZodString>;
        jobs: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            schedule: z.ZodString;
            handler: z.ZodString;
            enabled: z.ZodDefault<z.ZodBoolean>;
            timezone: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    health: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        intervalMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    gateway: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        bearerToken: z.ZodOptional<z.ZodString>;
        bearerTokens: z.ZodDefault<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            expiresAt: z.ZodOptional<z.ZodString>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    rateLimit: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        capacity: z.ZodDefault<z.ZodNumber>;
        refillPerSec: z.ZodDefault<z.ZodNumber>;
        exemptPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    providers: z.ZodDefault<z.ZodObject<{
        defaultProvider: z.ZodOptional<z.ZodString>;
        enableFallback: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    ai: z.ZodDefault<z.ZodObject<{
        activeModel: z.ZodOptional<z.ZodObject<{
            provider: z.ZodString;
            modelId: z.ZodString;
        }, z.core.$strip>>;
        localFirst: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        localOnly: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
    persistence: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        rootDir: z.ZodOptional<z.ZodString>;
        debounceMs: z.ZodDefault<z.ZodNumber>;
        prisma: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export declare class RuntimeConfigError extends Error {
    issues?: z.ZodIssue[];
    constructor(message: string, issues?: z.ZodIssue[]);
}
/**
 * Apply environment variable overrides. PYRFOR_* takes priority over legacy names.
 */
export declare function applyEnvOverrides(cfg: RuntimeConfig): RuntimeConfig;
export declare function loadConfig(filePath?: string): Promise<{
    config: RuntimeConfig;
    path: string;
    loadedFromLegacy: boolean;
}>;
/**
 * Atomic write: tmp file → fsync → rename. Creates parent directory.
 */
export declare function saveConfig(cfg: RuntimeConfig, filePath?: string): Promise<void>;
/**
 * Watch config file with debounce. Returns a dispose() function that stops watching.
 * Uses fs.watch (event-driven via kqueue/inotify) for low-latency hot-reload.
 */
export declare function watchConfig(filePath: string, onChange: (next: RuntimeConfig, prev: RuntimeConfig) => void, options?: {
    debounceMs?: number;
    onError?: (err: unknown) => void;
}): () => void;
//# sourceMappingURL=config.d.ts.map