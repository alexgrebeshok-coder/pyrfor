/**
 * Shared types for all AI providers.
 * Re-exported from lib/ai/providers.ts for backward compatibility.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: string;
  agentId?: string;
  runId?: string;
  workspaceId?: string;
  signal?: AbortSignal;
}

export interface AIProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}
