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
import { logger } from "@/lib/logger";
import type { AITool, ToolResult } from "@/lib/ai/tools/types";

// ============================================
// Plugin manifest schema
// ============================================

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/, "Plugin name must be lowercase alphanumeric"),
  version: z.string().default("1.0.0"),
  description: z.string(),
  author: z.string().optional(),
  /** Safety level: "read" (no mutations), "write" (mutations allowed), "admin" (system access) */
  safetyLevel: z.enum(["read", "write", "admin"]).default("read"),
  /** Whether this plugin is enabled */
  enabled: z.boolean().default(true),
  /** JSON Schema for parameters */
  parameters: z.record(z.string(), z.unknown()).optional(),
  /** Tags for discovery */
  tags: z.array(z.string()).optional(),
  /** Rate limit: max calls per minute */
  rateLimit: z.number().positive().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ============================================
// Plugin registry
// ============================================

export interface RegisteredPlugin {
  manifest: PluginManifest;
  tool: AITool;
  registeredAt: Date;
  callCount: number;
  lastCalledAt?: Date;
}

const _pluginRegistry = new Map<string, RegisteredPlugin>();

/**
 * Register a plugin with the tool system.
 */
export function registerPlugin(manifest: PluginManifest, tool: AITool): void {
  const validated = PluginManifestSchema.parse(manifest);

  if (!validated.enabled) {
    logger.info("plugin-system: skipping disabled plugin", { name: validated.name });
    return;
  }

  _pluginRegistry.set(validated.name, {
    manifest: validated,
    tool,
    registeredAt: new Date(),
    callCount: 0,
  });

  logger.info("plugin-system: plugin registered", {
    name: validated.name,
    version: validated.version,
    safetyLevel: validated.safetyLevel,
  });
}

/**
 * Get all registered plugins.
 */
export function getRegisteredPlugins(): RegisteredPlugin[] {
  return Array.from(_pluginRegistry.values());
}

/**
 * Get a specific plugin by name.
 */
export function getPlugin(name: string): RegisteredPlugin | null {
  return _pluginRegistry.get(name) ?? null;
}

/**
 * Execute a plugin by name.
 */
export async function executePlugin(
  name: string,
  params: Record<string, unknown>,
  options: { safetyOverride?: "strict" | "permissive" } = {}
): Promise<ToolResult> {
  const plugin = _pluginRegistry.get(name);
  if (!plugin) {
    return {
      success: false,
      data: null,
      error: `Plugin "${name}" not found`,
    };
  }

  if (!plugin.manifest.enabled) {
    return {
      success: false,
      data: null,
      error: `Plugin "${name}" is disabled`,
    };
  }

  // Safety guard: "admin" plugins require explicit override
  if (plugin.manifest.safetyLevel === "admin" && options.safetyOverride !== "permissive") {
    return {
      success: false,
      data: null,
      error: `Plugin "${name}" requires admin safety override`,
    };
  }

  try {
    plugin.callCount++;
    plugin.lastCalledAt = new Date();
    return await plugin.tool.execute(params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("plugin-system: execution error", { name, error: msg });
    return {
      success: false,
      data: null,
      error: msg,
    };
  }
}

/**
 * Convert registered plugins to AITool[] for inclusion in tool definitions.
 */
export function getPluginTools(): AITool[] {
  return Array.from(_pluginRegistry.values())
    .filter((p) => p.manifest.enabled)
    .map((p) => p.tool);
}

// ============================================
// Built-in utility plugins
// ============================================

/**
 * Register default built-in plugins.
 * Called once at application startup.
 */
export function registerBuiltinPlugins(): void {
  // Date/time helper
  registerPlugin(
    {
      name: "get_current_datetime",
      version: "1.0.0",
      description: "Get the current date and time in ISO format. Useful for date calculations.",
      safetyLevel: "read",
      enabled: true,
    },
    {
      name: "get_current_datetime",
      description: "Get the current date and time",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({
        success: true,
        data: {
          iso: new Date().toISOString(),
          timestamp: Date.now(),
          utc: new Date().toUTCString(),
        },
        error: undefined,
      }),
    }
  );

  // Math calculator
  registerPlugin(
    {
      name: "calculate",
      version: "1.0.0",
      description: "Evaluate a safe mathematical expression. Supports basic arithmetic.",
      safetyLevel: "read",
      enabled: true,
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "Math expression, e.g. '(120+80)*0.2'" } },
        required: ["expression"],
      },
    },
    {
      name: "calculate",
      description: "Evaluate a mathematical expression",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
      execute: async (params: Record<string, unknown>) => {
        const expr = String(params.expression ?? "");
        // Only allow safe chars
        if (!/^[\d\s+\-*/().%,]+$/.test(expr)) {
          return { success: false, data: null, error: "Unsafe expression" };
        }
        try {
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${expr})`)() as number;
          return { success: true, data: { result, expression: expr }, error: undefined };
        } catch {
          return { success: false, data: null, error: "Evaluation error" };
        }
      },
    }
  );

  logger.info("plugin-system: built-in plugins registered", {
    count: _pluginRegistry.size,
  });
}
