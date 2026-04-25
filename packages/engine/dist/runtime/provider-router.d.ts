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
export declare class ProviderRouter {
    private providers;
    private health;
    /** C1: Per-provider circuit-breaker state (only present while blacklisted). */
    private breakerState;
    private costLog;
    private options;
    private fallbackChain;
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