/**
 * Agent Loader — config-driven agent enrichment
 *
 * Loads per-agent JSON config from `config/agents/<agentId>.json` and merges
 * it with the static AIAgentDefinition. Enables runtime prompt tuning, model
 * overrides, and capability flags without code changes.
 *
 * Config file schema is validated with Zod so bad configs fail loudly.
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
import { z } from "zod";
import { logger } from '../observability/logger.js';
// ============================================
// Zod schema for agent config files
// ============================================
const AgentModelOverrideSchema = z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
});
const AgentCapabilitiesSchema = z.object({
    canSearchWeb: z.boolean().default(false),
    canReadFiles: z.boolean().default(false),
    canWriteFiles: z.boolean().default(false),
    canCallTools: z.boolean().default(false),
    canSpawnSubagents: z.boolean().default(false),
    canAccessDatabase: z.boolean().default(false),
    requiresHumanApproval: z.boolean().default(true),
});
export const AgentConfigSchema = z.object({
    /** Must match AIAgentDefinition.id */
    id: z.string(),
    /** Override display name (localisation-independent, for integrations) */
    displayName: z.string().optional(),
    /** System prompt prefix that gets prepended to every run */
    systemPromptPrefix: z.string().optional(),
    /** System prompt suffix appended after the context-injected prompt */
    systemPromptSuffix: z.string().optional(),
    /** Model override — if absent, uses workspace/global default */
    modelOverride: AgentModelOverrideSchema.optional(),
    /** Capability flags — controls what tools the agent may access */
    capabilities: AgentCapabilitiesSchema.optional(),
    /** Custom tags for filtering/analytics */
    tags: z.array(z.string()).optional(),
    /** Whether this agent is enabled (default: true) */
    enabled: z.boolean().default(true),
    /** Optional documentation URL */
    docsUrl: z.string().url().optional(),
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
function loadAgentConfig(agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (typeof window !== "undefined") {
            return null;
        }
        const cacheKey = agentId;
        const cached = _configCache.get(cacheKey);
        if (cached && Date.now() - _cacheWarmedAt < CACHE_TTL)
            return cached;
        try {
            const fs = yield import("node:fs/promises");
            const path = yield import("node:path");
            const configPath = path.join(process.cwd(), "config", "agents", `${agentId}.json`);
            const raw = yield fs.readFile(configPath, "utf-8");
            const parsed = AgentConfigSchema.parse(JSON.parse(raw));
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
            logger.warn("agent-loader: invalid agent config", {
                agentId,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    });
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
export function getEnrichedAgent(base) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield loadAgentConfig(base.id);
        const defaultConfig = {
            id: base.id,
            enabled: true,
            capabilities: DEFAULT_CAPABILITIES,
        };
        return Object.assign(Object.assign({}, base), { config: config !== null && config !== void 0 ? config : defaultConfig });
    });
}
/**
 * Warm all agent configs synchronously at startup (optional optimization).
 * Call from app startup code — non-blocking.
 */
export function warmAgentConfigCache(agentIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = yield Promise.allSettled(agentIds.map(loadAgentConfig));
        const loaded = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
        _cacheWarmedAt = Date.now();
        logger.info("agent-loader: config cache warmed", { total: agentIds.length, loaded });
    });
}
/**
 * Build a system prompt for an agent run, injecting config prefixes/suffixes.
 */
export function buildAgentSystemPrompt(basePrompt, config) {
    const parts = [];
    if (config.systemPromptPrefix)
        parts.push(config.systemPromptPrefix);
    parts.push(basePrompt);
    if (config.systemPromptSuffix)
        parts.push(config.systemPromptSuffix);
    return parts.join("\n\n");
}
