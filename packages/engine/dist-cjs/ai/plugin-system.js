"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManifestSchema = void 0;
exports.registerPlugin = registerPlugin;
exports.getRegisteredPlugins = getRegisteredPlugins;
exports.getPlugin = getPlugin;
exports.executePlugin = executePlugin;
exports.getPluginTools = getPluginTools;
exports.ensureBuiltinPluginsRegistered = ensureBuiltinPluginsRegistered;
exports.registerBuiltinPlugins = registerBuiltinPlugins;
const zod_1 = require("zod");
const logger_1 = require("../observability/logger");
// ============================================
// Plugin manifest schema
// ============================================
exports.PluginManifestSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[a-z0-9_-]+$/, "Plugin name must be lowercase alphanumeric"),
    version: zod_1.z.string().default("1.0.0"),
    description: zod_1.z.string(),
    author: zod_1.z.string().optional(),
    /** Safety level: "read" (no mutations), "write" (mutations allowed), "admin" (system access) */
    safetyLevel: zod_1.z.enum(["read", "write", "admin"]).default("read"),
    /** Whether this plugin is enabled */
    enabled: zod_1.z.boolean().default(true),
    /** JSON Schema for parameters */
    parameters: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    /** Tags for discovery */
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    /** Rate limit: max calls per minute */
    rateLimit: zod_1.z.number().positive().optional(),
});
const _pluginRegistry = new Map();
let _builtinPluginsRegistered = false;
/**
 * Register a plugin with the tool system.
 */
function registerPlugin(manifest, tool) {
    const validated = exports.PluginManifestSchema.parse(manifest);
    if (!validated.enabled) {
        logger_1.logger.info("plugin-system: skipping disabled plugin", { name: validated.name });
        return;
    }
    _pluginRegistry.set(validated.name, {
        manifest: validated,
        tool,
        registeredAt: new Date(),
        callCount: 0,
    });
    logger_1.logger.info("plugin-system: plugin registered", {
        name: validated.name,
        version: validated.version,
        safetyLevel: validated.safetyLevel,
    });
}
/**
 * Get all registered plugins.
 */
function getRegisteredPlugins() {
    return Array.from(_pluginRegistry.values());
}
/**
 * Get a specific plugin by name.
 */
function getPlugin(name) {
    return _pluginRegistry.get(name) ?? null;
}
/**
 * Execute a plugin by name.
 */
async function executePlugin(name, params, options = {}) {
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.error("plugin-system: execution error", { name, error: msg });
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
function getPluginTools() {
    return Array.from(_pluginRegistry.values())
        .filter((p) => p.manifest.enabled)
        .map((p) => p.tool);
}
function ensureBuiltinPluginsRegistered() {
    if (_builtinPluginsRegistered) {
        return;
    }
    _builtinPluginsRegistered = true;
    registerBuiltinPlugins();
}
// ============================================
// Built-in utility plugins
// ============================================
/**
 * Register default built-in plugins.
 * Called once at application startup.
 */
function registerBuiltinPlugins() {
    if (_pluginRegistry.has("get_current_datetime") || _pluginRegistry.has("calculate")) {
        return;
    }
    // Date/time helper
    registerPlugin({
        name: "get_current_datetime",
        version: "1.0.0",
        description: "Get the current date and time in ISO format. Useful for date calculations.",
        safetyLevel: "read",
        enabled: true,
    }, {
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
    });
    // Math calculator
    registerPlugin({
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
    }, {
        name: "calculate",
        description: "Evaluate a mathematical expression",
        parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
        },
        execute: async (params) => {
            const expr = String(params.expression ?? "");
            // Only allow safe chars
            if (!/^[\d\s+\-*/().%,]+$/.test(expr)) {
                return { success: false, data: null, error: "Unsafe expression" };
            }
            try {
                // eslint-disable-next-line no-new-func
                const result = Function(`"use strict"; return (${expr})`)();
                return { success: true, data: { result, expression: expr }, error: undefined };
            }
            catch {
                return { success: false, data: null, error: "Evaluation error" };
            }
        },
    });
    logger_1.logger.info("plugin-system: built-in plugins registered", {
        count: _pluginRegistry.size,
    });
}
