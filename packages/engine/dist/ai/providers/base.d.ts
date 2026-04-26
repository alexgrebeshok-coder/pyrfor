/**
 * Shared types for all AI providers.
 * Re-exported from lib/ai/providers.ts for backward compatibility.
 */
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface RoutingHints {
    /** Character count of the context to be sent; used to steer large contexts to cloud. */
    contextSizeChars?: number;
    /** When true, prefer local inference to avoid sending data to cloud providers. */
    sensitive?: boolean;
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
    /**
     * Per-request routing preference.
     * Precedence: activeModel > opts.prefer > localOnly > localFirst > defaultChain.
     * 'local'  → put mlx/ollama first in the fallback chain.
     * 'cloud'  → put cloud providers first, local at the tail.
     * 'auto'   → apply rule-based defaults (see routingHints).
     * undefined → same as 'auto'.
     */
    prefer?: 'local' | 'cloud' | 'auto';
    /** Hints used when prefer is 'auto' or undefined to determine the best chain. */
    routingHints?: RoutingHints;
}
export interface AIProvider {
    name: string;
    models: string[];
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}
//# sourceMappingURL=base.d.ts.map