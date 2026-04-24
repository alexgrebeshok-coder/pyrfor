/**
 * Provider Router — Smart provider selection with fallback
 *
 * Features:
 * - Takes a message, picks best provider
 * - Fallback chain: ZAI → OpenRouter → Ollama (local)
 * - Cost tracking per session
 * - Rate limit awareness
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
    /** Max retries per provider */
    maxRetries?: number;
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
export declare class ProviderRouter {
    private providers;
    private health;
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
     * Chat with automatic fallback
     */
    chat(messages: Message[], options?: ChatOptions & {
        sessionId?: string;
    }): Promise<string>;
    /**
     * Stream chat with fallback
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
     * Get health status of all providers
     */
    getHealth(): ProviderHealth[];
    /**
     * Reset provider health
     */
    resetHealth(providerName: string): void;
    private buildFallbackChain;
    private withTimeout;
    private delay;
    private logCost;
    private updateHealth;
}
export declare const providerRouter: ProviderRouter;
