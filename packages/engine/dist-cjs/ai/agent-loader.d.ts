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
import type { AIAgentDefinition } from './types';
export declare const AgentConfigSchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    systemPromptPrefix: z.ZodOptional<z.ZodString>;
    systemPromptSuffix: z.ZodOptional<z.ZodString>;
    modelOverride: z.ZodOptional<z.ZodObject<{
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    capabilities: z.ZodOptional<z.ZodObject<{
        canSearchWeb: z.ZodDefault<z.ZodBoolean>;
        canReadFiles: z.ZodDefault<z.ZodBoolean>;
        canWriteFiles: z.ZodDefault<z.ZodBoolean>;
        canCallTools: z.ZodDefault<z.ZodBoolean>;
        canSpawnSubagents: z.ZodDefault<z.ZodBoolean>;
        canAccessDatabase: z.ZodDefault<z.ZodBoolean>;
        requiresHumanApproval: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    docsUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export interface EnrichedAgentDefinition extends AIAgentDefinition {
    config: AgentConfig;
}
/**
 * Get an enriched agent definition by ID.
 * Merges static definition with on-disk config (if any).
 */
export declare function getEnrichedAgent(base: AIAgentDefinition): Promise<EnrichedAgentDefinition>;
/**
 * Warm all agent configs synchronously at startup (optional optimization).
 * Call from app startup code — non-blocking.
 */
export declare function warmAgentConfigCache(agentIds: string[]): Promise<void>;
/**
 * Build a system prompt for an agent run, injecting config prefixes/suffixes.
 */
export declare function buildAgentSystemPrompt(basePrompt: string, config: AgentConfig): string;
//# sourceMappingURL=agent-loader.d.ts.map