// @freeclaude/coder — Core types
// Bridges FreeClaude CLI (Bun) to @ceoclaw/engine/ai provider router

export type FreeCloudeMode = 'chat' | 'agent' | 'vibe'
export type ProviderName = 'openrouter' | 'openai' | 'gigachat' | 'yandexgpt' | 'zai'

export interface FreeClaude_QueryConfig {
  /** User or session ID */
  userId: string
  /** Which provider to use (or 'auto' for router) */
  provider: ProviderName | 'auto'
  /** Model slug, e.g. "gpt-4o", "claude-3-5-sonnet" */
  model: string
  /** Interaction mode */
  mode: FreeCloudeMode
  /** System prompt override */
  systemPrompt?: string
  /** Max output tokens */
  maxTokens?: number
  /** Temperature */
  temperature?: number
  /** Whether to enable tool use */
  tools?: boolean
  /** Code project context */
  projectId?: string
}

export interface FreeClaude_ProviderRoute {
  provider: ProviderName
  model: string
  /** Cost estimate in USD per 1M tokens */
  costPer1M: number
  /** Is this provider available right now? */
  available: boolean
}

export interface FreeClaude_SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolName?: string
  toolCallId?: string
  timestamp: number
}

export interface FreeClaude_SessionState {
  sessionId: string
  userId: string
  projectId?: string | null
  provider: ProviderName
  model: string
  mode: FreeCloudeMode
  messages: FreeClaude_SessionMessage[]
  totalCost: number
  createdAt: Date
  updatedAt: Date
}

export interface FreeClaude_ArtifactMeta {
  id: string
  projectId: string
  type: 'page' | 'component' | 'api' | 'config' | 'test' | 'docs'
  filename: string
  version: number
  createdAt: Date
}
