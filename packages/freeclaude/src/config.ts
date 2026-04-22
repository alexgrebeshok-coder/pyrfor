// @freeclaude/coder — Config bridge
// Reads FreeClaude config (compatible with .freeclaude.json) and exposes
// a typed configuration object.  No file I/O here — caller reads the file.

import type { FreeCloudeMode, ProviderName } from './types'

export interface FreeClaudeConfig {
  /** Default provider for new sessions */
  defaultProvider: ProviderName | 'auto'
  /** Default model slug */
  defaultModel: string
  /** Default interaction mode */
  defaultMode: FreeCloudeMode
  /** Whether MCP tools are enabled */
  mcpEnabled: boolean
  /** Preferred language for AI responses */
  lang: 'ru' | 'en' | 'auto'
  /** System prompt prefix (appended before task) */
  systemPromptPrefix?: string
  /** Whether to save sessions to DB */
  persistSessions: boolean
  /** Max cost per session in USD (0 = unlimited) */
  maxSessionCostUsd: number
}

export const DEFAULT_CONFIG: FreeClaudeConfig = {
  defaultProvider: 'auto',
  defaultModel: 'claude-3-5-sonnet',
  defaultMode: 'chat',
  mcpEnabled: false,
  lang: 'auto',
  persistSessions: true,
  maxSessionCostUsd: 0,
}

/**
 * Parse raw config object (e.g. from .freeclaude.json) into FreeClaudeConfig.
 * Unknown keys are ignored; missing keys fall back to defaults.
 */
export function parseConfig(raw: Record<string, unknown>): FreeClaudeConfig {
  return {
    defaultProvider: (raw.defaultProvider as ProviderName | 'auto') ?? DEFAULT_CONFIG.defaultProvider,
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : DEFAULT_CONFIG.defaultModel,
    defaultMode: (raw.defaultMode as FreeCloudeMode) ?? DEFAULT_CONFIG.defaultMode,
    mcpEnabled: typeof raw.mcpEnabled === 'boolean' ? raw.mcpEnabled : DEFAULT_CONFIG.mcpEnabled,
    lang: (raw.lang as 'ru' | 'en' | 'auto') ?? DEFAULT_CONFIG.lang,
    systemPromptPrefix: typeof raw.systemPromptPrefix === 'string' ? raw.systemPromptPrefix : undefined,
    persistSessions: typeof raw.persistSessions === 'boolean' ? raw.persistSessions : DEFAULT_CONFIG.persistSessions,
    maxSessionCostUsd: typeof raw.maxSessionCostUsd === 'number' ? raw.maxSessionCostUsd : DEFAULT_CONFIG.maxSessionCostUsd,
  }
}

/**
 * Merge user config over defaults.
 */
export function mergeConfig(partial: Partial<FreeClaudeConfig>): FreeClaudeConfig {
  return { ...DEFAULT_CONFIG, ...partial }
}
