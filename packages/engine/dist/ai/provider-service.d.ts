/**
 * provider-service.ts — Thin facade in front of the LLM provider router.
 *
 * Provides a single, mockable, contract-stable API for "send a chat completion"
 * to the rest of the engine (FreeClaude mode, slash commands, VSCode extension,
 * MCP adapter).
 *
 * RouterLike is derived from the actual public surface of
 * packages/engine/src/runtime/llm-provider-router.ts.
 *
 * Mapping:
 *   RouterLike.call(LlmRequest, opts?)  →  wraps LlmProviderRouter.call()
 *   RouterLike.listProviders?()         →  wraps LlmProviderRouter.listProviders()
 *
 *   ChatRequest  → LlmRequest
 *     messages              → messages (role+content forwarded; extra fields preserved)
 *     temperature           → temperature
 *     maxTokens             → maxTokens
 *     tools                 → tools
 *     signal                → signal
 *     modelProfile==='fast' → preferCheapFor='simple'; otherwise 'complex'
 *     providerHint          → opts.order=[providerHint]
 *     stop, metadata        → not forwarded (no slot in LlmRequest)
 *
 *   LlmResponse → ChatResponse
 *     text       → content
 *     provider   → provider
 *     toolCalls  → toolCalls  (normalised to {id,name,arguments})
 *     usage      → usage      (totalTokens added; fallback to estimateUsage)
 *     latencyMs  → latencyMs  (re-measured by service; router value ignored)
 */
import type { LlmRequest, LlmResponse, ProviderStatus } from '../runtime/llm-provider-router';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: unknown;
    }>;
}
export interface ChatRequest {
    messages: ChatMessage[];
    /** Opaque label routed by the underlying router: 'fast' | 'balanced' | 'reasoning' */
    modelProfile?: string;
    /** Optional preferred provider name */
    providerHint?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
    }>;
    stop?: string[];
    /** Passed through to ledger / caller; not forwarded to the router */
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
}
export interface ChatResponse {
    content: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: unknown;
    }>;
    finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
    model: string;
    provider: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUsd?: number;
    };
    latencyMs: number;
}
/** Mockable facade for the engine's chat-completion surface */
export interface ProviderClient {
    chat(req: ChatRequest): Promise<ChatResponse>;
    listProviders(): Array<{
        name: string;
        available: boolean;
    }>;
}
export interface RouterLike {
    call(req: LlmRequest, opts?: {
        order?: string[];
        maxAttempts?: number;
    }): Promise<LlmResponse>;
    listProviders?(): ProviderStatus[];
}
/**
 * Classify an error for retry decisions.
 *   - AbortError name      → 'cancelled'
 *   - Network / 5xx codes  → 'transient'
 *   - Everything else      → 'permanent'
 */
export declare function classifyError(e: unknown): 'transient' | 'permanent' | 'cancelled';
/**
 * Strip messages with empty (or whitespace-only) content, but always preserve
 * tool messages regardless of content.  Original ordering is retained.
 */
export declare function normalizeMessages(msgs: ChatMessage[]): ChatMessage[];
/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * Used only as a fallback when the router does not return usage metadata.
 */
export declare function estimateUsage(req: ChatRequest, content: string): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};
export interface ProviderServiceOptions {
    router: RouterLike;
    defaultModelProfile?: string;
    defaultTimeoutMs?: number;
    retry?: {
        /** Total number of attempts (including the first). Default: 1 (no retry). */
        attempts?: number;
        /** Linear backoff base in ms: wait = attempt * backoffMs. Default: 500. */
        backoffMs?: number;
    };
}
export declare class ProviderService implements ProviderClient {
    private readonly router;
    private readonly defaultModelProfile;
    private readonly defaultTimeoutMs;
    private readonly maxAttempts;
    private readonly backoffMs;
    private readonly errorListeners;
    constructor(opts: ProviderServiceOptions);
    chat(req: ChatRequest): Promise<ChatResponse>;
    listProviders(): Array<{
        name: string;
        available: boolean;
    }>;
    /** Subscribe to all errors (transient, permanent, cancelled).  Returns an unsubscribe fn. */
    onError(cb: (e: Error) => void): () => void;
    private emitError;
}
//# sourceMappingURL=provider-service.d.ts.map