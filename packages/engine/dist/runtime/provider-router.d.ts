/**
 * Provider Router — Smart provider selection with fallback
 *
 * Features:
 * - Takes a message, picks best provider
 * - Fallback chain: ZAI → OpenRouter → Ollama (local)
 * - Cost tracking per session (capped at 1 000 entries)
 * - Rate limit awareness with Retry-After parsing (C3)
 * - Circuit-breaker with auto-reset / half-open probe (C1)
 * - Stream-drop resilience with partial-content bridge (C2)
 * - NO privacy guard blocks
 */
import type { AIProvider, Message, ChatOptions } from '../ai/providers/base';
export interface ProviderRouterOptions {
    /** Default provider to try first */
    defaultProvider?: string;
    /** Enable fallback chain */
    enableFallback?: boolean;
    /** Timeout per provider in ms */
    timeoutMs?: number;
    /** Max retries per provider for generic (non-HTTP) errors */
    maxRetries?: number;
    /**
     * C1: Initial circuit-breaker cooldown after blacklisting (ms, default 60 000).
     * Subsequent trips use exponential backoff: 1× → 5× → 30×.
     */
    breakerCooldownMs?: number;
}
export interface ProviderCost {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    timestamp: Date;
    sessionId?: string;
}
export interface ProviderHealth {
    provider: string;
    available: boolean;
    lastError?: string;
    lastUsed?: Date;
    consecutiveFailures: number;
    avgResponseTimeMs: number;
}
export interface ModelEntry {
    provider: string;
    id: string;
    label?: string;
    available: boolean;
}
/**
 * C3: Structured HTTP error for providers to throw when the underlying
 * transport returns a status code.  Enables smart 429 / 5xx retry logic.
 */
export declare class ProviderHttpError extends Error {
    readonly status: number;
    /** Retry-After value in seconds (for 429 responses). */
    readonly retryAfter?: number | undefined;
    constructor(status: number, message: string, 
    /** Retry-After value in seconds (for 429 responses). */
    retryAfter?: number | undefined);
}
/**
 * C2: Thrown when the entire streaming fallback chain is exhausted without
 * a successful completion.
 */
export declare class StreamFailedError extends Error {
    constructor(message: string);
}
/**
 * Thrown when localOnly mode is enabled but no local provider (mlx/ollama) is available.
 */
export declare class LocalOnlyNoProvidersError extends Error {
    constructor();
}
export declare class ProviderRouter {
    private providers;
    private health;
    /** C1: Per-provider circuit-breaker state (only present while blacklisted). */
    private breakerState;
    private costLog;
    private options;
    private activeModelHint?;
    private readonly originalFallbackChain;
    private fallbackChain;
    /** Local provider names (always keep in sync with initializeProviders). */
    private static readonly LOCAL_PROVIDERS;
    /** Cloud provider names (all registered providers that are NOT local). */
    private static readonly CLOUD_PROVIDERS;
    private localFirst;
    private localOnly;
    constructor(options?: ProviderRouterOptions);
    /**
     * Initialize available providers from environment
     */
    private initializeProviders;
    /**
     * Register a provider
     */
    register(name: string, provider: AIProvider): void;
    /**
     * Get available provider names
     */
    getAvailableProviders(): string[];
    /**
     * Check if we have any available providers
     */
    hasAvailableProvider(): boolean;
    /**
     * Set the active model hint. Used by the gateway/UI to bias provider
     * selection toward a user-chosen provider/model.
     */
    setActiveModel(provider: string, modelId: string): void;
    /**
     * Get the currently active model hint, if set.
     */
    getActiveModel(): {
        provider: string;
        modelId: string;
    } | undefined;
    /**
     * Configure local-first / local-only mode and recompute the fallback chain.
     * - localOnly: only mlx and ollama are tried; throws LocalOnlyNoProvidersError
     *   if neither is available.
     * - localFirst: mlx and ollama come first, then the original cloud chain order.
     * - neither: original chain is restored.
     */
    setLocalMode({ localFirst, localOnly }: {
        localFirst: boolean;
        localOnly: boolean;
    }): void;
    /**
     * Get the current local mode settings.
     */
    getLocalMode(): {
        localFirst: boolean;
        localOnly: boolean;
    };
    /**
     * List all models across all registered providers. Providers exposing a
     * `listModels()` method are queried dynamically; otherwise their static
     * `models` array is reported. Failed providers are reported as unavailable.
     */
    listAllModels(): Promise<ModelEntry[]>;
    /**
     * Chat with automatic fallback.
     * C1: skips blacklisted providers until cooldown expires, then probes (half-open).
     * C3: wraps each call with HTTP-aware 429/5xx retry before generic retry.
     */
    chat(messages: Message[], options?: ChatOptions & {
        sessionId?: string;
    }): Promise<string>;
    /**
     * Stream chat with fallback.
     * C2: if the underlying stream throws mid-response (after yielding ≥1 token),
     * emits a bridge delta '\n[switched provider]\n' then continues on the next provider.
     */
    chatStream(messages: Message[], options?: ChatOptions & {
        sessionId?: string;
    }): AsyncGenerator<string, void, unknown>;
    /**
     * Get cost summary for a session
     */
    getSessionCost(sessionId: string): {
        totalUsd: number;
        calls: number;
        byProvider: Record<string, number>;
    };
    /**
     * Get total cost for all sessions
     */
    getTotalCost(): {
        totalUsd: number;
        calls: number;
        byProvider: Record<string, number>;
    };
    /**
     * Return a copy of the internal cost log, optionally limited to the last
     * `limit` entries.
     */
    getCostLog(limit?: number): ProviderCost[];
    /**
     * Get health status of all providers
     */
    getHealth(): ProviderHealth[];
    /**
     * Reset provider health (also clears the C1 circuit-breaker state).
     */
    resetHealth(providerName: string): void;
    private buildFallbackChain;
    /**
     * Determine the effective fallback chain order for a single request.
     *
     * Precedence (highest → lowest):
     *   activeModel > opts.prefer > localOnly > localFirst > defaultChain
     *
     * NOTE: activeModel / options.provider win because `buildFallbackChain` always
     * places the explicitly-requested provider first, BEFORE this method's result
     * is used as the tail ordering.
     *
     * `prefer` only reorders — the full chain is still attempted on errors.
     */
    private resolvePreferredChain;
    /** Recompute the active fallback chain based on localFirst / localOnly settings. */
    private recomputeFallbackChain;
    /**
     * C3: Wrap a single provider call with HTTP-aware retry.
     * - 429 (ProviderHttpError): wait Retry-After (default 1 s) then retry — up to 2 retries.
     * - 5xx (ProviderHttpError): exponential back-off 250 ms → 1 000 ms — up to 2 retries.
     * - All other errors are re-thrown immediately for the outer loop to handle.
     */
    private callWithHttpRetry;
    private withTimeout;
    /** Add ±20 % jitter to a delay to avoid thundering-herd on retries. */
    private jitter;
    private delay;
    private logCost;
    private updateHealth;
}
export declare const providerRouter: ProviderRouter;
//# sourceMappingURL=provider-router.d.ts.map