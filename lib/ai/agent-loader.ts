/**
 * Agent Loader — config-driven agent enrichment
 *
 * Loads per-agent JSON config from `config/agents/<agentId>.json` and merges
 * it with the static AIAgentDefinition. Enables runtime prompt tuning, model
 * overrides, and capability flags without code changes.
 *
 * Config file schema is validated with Zod so bad configs fail loudly.
 */

import { z } from "zod";
import { logger } from "@/lib/logger";
import type { AIAgentDefinition } from "@/lib/ai/types";

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

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================
// Enriched agent definition
// ============================================

export interface EnrichedAgentDefinition extends AIAgentDefinition {
  config: AgentConfig;
}

// ============================================
// Config loader (cached, lazy)
// ============================================

const _configCache = new Map<string, AgentConfig>();
let _cacheWarmedAt = 0;
const CACHE_TTL = 60_000; // 1 min — reload in dev without restart

/**
 * Load and validate agent config from disk.
 * Returns null if the file doesn't exist (not an error — base definition is used).
 */
async function loadAgentConfig(agentId: string): Promise<AgentConfig | null> {
  const cacheKey = agentId;
  const cached = _configCache.get(cacheKey);
  if (cached && Date.now() - _cacheWarmedAt < CACHE_TTL) return cached;

  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const configPath = path.join(process.cwd(), "config", "agents", `${agentId}.json`);
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = AgentConfigSchema.parse(JSON.parse(raw));
    _configCache.set(cacheKey, parsed);
    return parsed;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      // Config file doesn't exist — that's fine
      return null;
    }
    logger.warn("agent-loader: invalid agent config", {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Default capabilities for agents that have no config file */
const DEFAULT_CAPABILITIES: AgentConfig["capabilities"] = {
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
export async function getEnrichedAgent(
  base: AIAgentDefinition
): Promise<EnrichedAgentDefinition> {
  const config = await loadAgentConfig(base.id);
  const defaultConfig: AgentConfig = {
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
export async function warmAgentConfigCache(agentIds: string[]): Promise<void> {
  const results = await Promise.allSettled(agentIds.map(loadAgentConfig));
  const loaded = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
  _cacheWarmedAt = Date.now();
  logger.info("agent-loader: config cache warmed", { total: agentIds.length, loaded });
}

/**
 * Build a system prompt for an agent run, injecting config prefixes/suffixes.
 */
export function buildAgentSystemPrompt(
  basePrompt: string,
  config: AgentConfig
): string {
  const parts: string[] = [];
  if (config.systemPromptPrefix) parts.push(config.systemPromptPrefix);
  parts.push(basePrompt);
  if (config.systemPromptSuffix) parts.push(config.systemPromptSuffix);
  return parts.join("\n\n");
}
