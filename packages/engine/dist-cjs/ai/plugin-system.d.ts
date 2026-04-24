/**
 * AI Tool Plugin System
 *
 * Extends the tool registry with dynamically loadable plugins.
 * Plugins are loaded from config/plugins/*.json (manifest) + lib/ai/plugins/<name>.ts (handler).
 *
 * Plugin contract:
 * - Declares name, description, parameters (JSON Schema)
 * - Exports execute(params) function
 * - Optional: requiresAuth, rateLimit, safetyLevel
 *
 * Built-in plugins: none (registry starts empty)
 * Custom plugins: mounted at runtime via registerPlugin()
 */
import { z } from "zod";
import type { AITool, ToolResult } from './tools/types';
export declare const PluginManifestSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    description: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    safetyLevel: z.ZodDefault<z.ZodEnum<{
        read: "read";
        write: "write";
        admin: "admin";
    }>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    rateLimit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export interface RegisteredPlugin {
    manifest: PluginManifest;
    tool: AITool;
    registeredAt: Date;
    callCount: number;
    lastCalledAt?: Date;
}
/**
 * Register a plugin with the tool system.
 */
export declare function registerPlugin(manifest: PluginManifest, tool: AITool): void;
/**
 * Get all registered plugins.
 */
export declare function getRegisteredPlugins(): RegisteredPlugin[];
/**
 * Get a specific plugin by name.
 */
export declare function getPlugin(name: string): RegisteredPlugin | null;
/**
 * Execute a plugin by name.
 */
export declare function executePlugin(name: string, params: Record<string, unknown>, options?: {
    safetyOverride?: "strict" | "permissive";
}): Promise<ToolResult>;
/**
 * Convert registered plugins to AITool[] for inclusion in tool definitions.
 */
export declare function getPluginTools(): AITool[];
export declare function ensureBuiltinPluginsRegistered(): void;
/**
 * Register default built-in plugins.
 * Called once at application startup.
 */
export declare function registerBuiltinPlugins(): void;
//# sourceMappingURL=plugin-system.d.ts.map