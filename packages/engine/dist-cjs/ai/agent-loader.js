"use strict";
/**
 * Agent Loader — config-driven agent enrichment
 *
 * Loads per-agent JSON config from `config/agents/<agentId>.json` and merges
 * it with the static AIAgentDefinition. Enables runtime prompt tuning, model
 * overrides, and capability flags without code changes.
 *
 * Config file schema is validated with Zod so bad configs fail loudly.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentConfigSchema = void 0;
exports.getEnrichedAgent = getEnrichedAgent;
exports.warmAgentConfigCache = warmAgentConfigCache;
exports.buildAgentSystemPrompt = buildAgentSystemPrompt;
const zod_1 = require("zod");
const logger_1 = require("../observability/logger");
// ============================================
// Zod schema for agent config files
// ============================================
const AgentModelOverrideSchema = zod_1.z.object({
    provider: zod_1.z.string().optional(),
    model: zod_1.z.string().optional(),
    temperature: zod_1.z.number().min(0).max(2).optional(),
    maxTokens: zod_1.z.number().positive().optional(),
});
const AgentCapabilitiesSchema = zod_1.z.object({
    canSearchWeb: zod_1.z.boolean().default(false),
    canReadFiles: zod_1.z.boolean().default(false),
    canWriteFiles: zod_1.z.boolean().default(false),
    canCallTools: zod_1.z.boolean().default(false),
    canSpawnSubagents: zod_1.z.boolean().default(false),
    canAccessDatabase: zod_1.z.boolean().default(false),
    requiresHumanApproval: zod_1.z.boolean().default(true),
});
exports.AgentConfigSchema = zod_1.z.object({
    /** Must match AIAgentDefinition.id */
    id: zod_1.z.string(),
    /** Override display name (localisation-independent, for integrations) */
    displayName: zod_1.z.string().optional(),
    /** System prompt prefix that gets prepended to every run */
    systemPromptPrefix: zod_1.z.string().optional(),
    /** System prompt suffix appended after the context-injected prompt */
    systemPromptSuffix: zod_1.z.string().optional(),
    /** Model override — if absent, uses workspace/global default */
    modelOverride: AgentModelOverrideSchema.optional(),
    /** Capability flags — controls what tools the agent may access */
    capabilities: AgentCapabilitiesSchema.optional(),
    /** Custom tags for filtering/analytics */
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    /** Whether this agent is enabled (default: true) */
    enabled: zod_1.z.boolean().default(true),
    /** Optional documentation URL */
    docsUrl: zod_1.z.string().url().optional(),
});
// ============================================
// Config loader (cached, lazy)
// ============================================
const _configCache = new Map();
let _cacheWarmedAt = 0;
const CACHE_TTL = 60000; // 1 min — reload in dev without restart
/**
 * Load and validate agent config from disk.
 * Returns null if the file doesn't exist (not an error — base definition is used).
 */
async function loadAgentConfig(agentId) {
    if (typeof window !== "undefined") {
        return null;
    }
    const cacheKey = agentId;
    const cached = _configCache.get(cacheKey);
    if (cached && Date.now() - _cacheWarmedAt < CACHE_TTL)
        return cached;
    try {
        const fs = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
        const path = await Promise.resolve().then(() => __importStar(require("node:path")));
        const configPath = path.join(process.cwd(), "config", "agents", `${agentId}.json`);
        const raw = await fs.readFile(configPath, "utf-8");
        const parsed = exports.AgentConfigSchema.parse(JSON.parse(raw));
        _configCache.set(cacheKey, parsed);
        return parsed;
    }
    catch (err) {
        if (typeof err === "object" &&
            err !== null &&
            "code" in err &&
            err.code === "ENOENT") {
            // Config file doesn't exist — that's fine
            return null;
        }
        logger_1.logger.warn("agent-loader: invalid agent config", {
            agentId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
/** Default capabilities for agents that have no config file */
const DEFAULT_CAPABILITIES = {
    canSearchWeb: false,
    canReadFiles: false,
    canWriteFiles: false,
    canCallTools: false,
    canSpawnSubagents: false,
    canAccessDatabase: false,
    requiresHumanApproval: true,
};
/**
 * Get an enriched agent definition by ID.
 * Merges static definition with on-disk config (if any).
 */
async function getEnrichedAgent(base) {
    const config = await loadAgentConfig(base.id);
    const defaultConfig = {
        id: base.id,
        enabled: true,
        capabilities: DEFAULT_CAPABILITIES,
    };
    return {
        ...base,
        config: config ?? defaultConfig,
    };
}
/**
 * Warm all agent configs synchronously at startup (optional optimization).
 * Call from app startup code — non-blocking.
 */
async function warmAgentConfigCache(agentIds) {
    const results = await Promise.allSettled(agentIds.map(loadAgentConfig));
    const loaded = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
    _cacheWarmedAt = Date.now();
    logger_1.logger.info("agent-loader: config cache warmed", { total: agentIds.length, loaded });
}
/**
 * Build a system prompt for an agent run, injecting config prefixes/suffixes.
 */
function buildAgentSystemPrompt(basePrompt, config) {
    const parts = [];
    if (config.systemPromptPrefix)
        parts.push(config.systemPromptPrefix);
    parts.push(basePrompt);
    if (config.systemPromptSuffix)
        parts.push(config.systemPromptSuffix);
    return parts.join("\n\n");
}
