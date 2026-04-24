"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRouter = exports.ProviderRouter = void 0;
const zai_1 = require("../ai/providers/zai");
const zhipu_1 = require("../ai/providers/zhipu");
const openrouter_1 = require("../ai/providers/openrouter");
const openai_1 = require("../ai/providers/openai");
const gigachat_1 = require("../ai/providers/gigachat");
const yandexgpt_1 = require("../ai/providers/yandexgpt");
const ollama_1 = require("../ai/providers/ollama");
const tokens_1 = require("../utils/tokens");
const logger_1 = require("../observability/logger");
// ============================================
// Cost Estimation
// ============================================
// Rough cost per 1K tokens (input / output) in USD
const COST_RATES = {
    zai: { input: 0.0005, output: 0.0015 }, // Very cheap
    openrouter: { input: 0.002, output: 0.006 }, // Variable, using average
    openai: { input: 0.003, output: 0.006 }, // GPT-4o-mini rates
    ollama: { input: 0, output: 0 }, // Free (local)
};
function estimateCost(provider, inputTokens, outputTokens) {
    const rates = COST_RATES[provider] || COST_RATES.openrouter;
    return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}
// ============================================
// Provider Router
// ============================================
class ProviderRouter {
    constructor(options = {}) {
        this.providers = new Map();
        this.health = new Map();
        this.costLog = [];
        // Fallback chain priority
        this.fallbackChain = ['zhipu', 'zai', 'openrouter', 'ollama', 'gigachat', 'yandexgpt'];
        this.options = {
            defaultProvider: options.defaultProvider || 'zhipu',
            enableFallback: options.enableFallback ?? true,
            timeoutMs: options.timeoutMs || 60000,
            maxRetries: options.maxRetries || 2,
        };
        this.initializeProviders();
    }
    /**
     * Initialize available providers from environment
     */
    initializeProviders() {
        // Zhipu AI (api.z.ai) — primary, direct access
        if (process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY) {
            try {
                const zhipu = new zhipu_1.ZhipuProvider(process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY);
                this.register('zhipu', zhipu);
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize Zhipu provider', { error: String(error) });
            }
        }
        // ZAI (ZukiJourney proxy) — fallback
        if (process.env.ZAI_API_KEY && process.env.ZAI_API_KEY !== process.env.ZHIPU_API_KEY) {
            try {
                const zai = new zai_1.ZAIProvider();
                this.register('zai', zai);
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize ZAI provider', { error: String(error) });
            }
        }
        // OpenRouter - fallback with many models
        if (process.env.OPENROUTER_API_KEY) {
            try {
                const openrouter = new openrouter_1.OpenRouterProvider();
                this.register('openrouter', openrouter);
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize OpenRouter provider', { error: String(error) });
            }
        }
        // OpenAI
        if (process.env.OPENAI_API_KEY) {
            try {
                const openai = new openai_1.OpenAIProvider();
                this.register('openai', openai);
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize OpenAI provider', { error: String(error) });
            }
        }
        // Ollama (local) - always available but might not be running
        this.register('ollama', new ollama_1.OllamaProvider());
        // Russian providers
        if (process.env.GIGACHAT_API_KEY) {
            try {
                this.register('gigachat', new gigachat_1.GigaChatProvider());
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize GigaChat provider', { error: String(error) });
            }
        }
        if (process.env.YANDEX_API_KEY) {
            try {
                this.register('yandexgpt', new yandexgpt_1.YandexGPTProvider());
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize YandexGPT provider', { error: String(error) });
            }
        }
        logger_1.logger.info('Provider router initialized', {
            available: Array.from(this.providers.keys()),
            default: this.options.defaultProvider,
        });
    }
    /**
     * Register a provider
     */
    register(name, provider) {
        this.providers.set(name, provider);
        this.health.set(name, {
            provider: name,
            available: true,
            consecutiveFailures: 0,
            avgResponseTimeMs: 0,
        });
    }
    /**
     * Get available provider names
     */
    getAvailableProviders() {
        return Array.from(this.providers.keys()).filter(name => {
            const h = this.health.get(name);
            return h?.available !== false && (h?.consecutiveFailures ?? 0) < 3;
        });
    }
    /**
     * Check if we have any available providers
     */
    hasAvailableProvider() {
        return this.getAvailableProviders().length > 0;
    }
    /**
     * Chat with automatic fallback
     */
    async chat(messages, options) {
        const preferredProvider = options?.provider || this.options.defaultProvider;
        const chain = this.buildFallbackChain(preferredProvider);
        const inputTokens = messages.reduce((sum, m) => sum + (0, tokens_1.estimateTokens)(m.content), 0);
        let lastError = '';
        for (const providerName of chain) {
            const provider = this.providers.get(providerName);
            if (!provider)
                continue;
            const health = this.health.get(providerName);
            if (health && !health.available) {
                logger_1.logger.debug('Skipping unavailable provider', { provider: providerName });
                continue;
            }
            for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
                const startMs = Date.now();
                try {
                    // Use timeout wrapper
                    const response = await this.withTimeout(provider.chat(messages, { ...options, provider: providerName }), this.options.timeoutMs);
                    const durationMs = Date.now() - startMs;
                    const outputTokens = (0, tokens_1.estimateTokens)(response);
                    const costUsd = estimateCost(providerName, inputTokens, outputTokens);
                    // Log success
                    this.logCost({
                        provider: providerName,
                        model: options?.model || provider.models[0] || 'unknown',
                        inputTokens,
                        outputTokens,
                        costUsd,
                        timestamp: new Date(),
                        sessionId: options?.sessionId,
                    });
                    // Update health
                    this.updateHealth(providerName, true, durationMs);
                    logger_1.logger.debug('Provider succeeded', {
                        provider: providerName,
                        durationMs,
                        costUsd: costUsd.toFixed(6),
                        attempt: attempt + 1,
                    });
                    return response;
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    lastError = msg;
                    // Don't retry on auth or rate limit errors
                    if (msg.includes('401') || msg.includes('403') || msg.includes('429')) {
                        logger_1.logger.warn('Provider auth/rate error, skipping retry', {
                            provider: providerName,
                            error: msg,
                        });
                        break;
                    }
                    logger_1.logger.warn('Provider attempt failed', {
                        provider: providerName,
                        attempt: attempt + 1,
                        error: msg.slice(0, 200),
                    });
                    if (attempt < this.options.maxRetries - 1) {
                        await this.delay(500 * (attempt + 1));
                    }
                }
            }
            // Mark provider as potentially having issues
            this.updateHealth(providerName, false);
        }
        throw new Error(`All providers failed. Last error: ${lastError}`);
    }
    /**
     * Stream chat with fallback
     */
    async *chatStream(messages, options) {
        const preferredProvider = options?.provider || this.options.defaultProvider;
        const chain = this.buildFallbackChain(preferredProvider);
        for (const providerName of chain) {
            const provider = this.providers.get(providerName);
            if (!provider?.chatStream)
                continue;
            try {
                yield* provider.chatStream(messages, options);
                this.updateHealth(providerName, true, 0);
                return;
            }
            catch (error) {
                logger_1.logger.warn('Stream provider failed, trying fallback', {
                    provider: providerName,
                    error: String(error).slice(0, 200),
                });
                this.updateHealth(providerName, false);
            }
        }
        throw new Error('No streaming providers available');
    }
    /**
     * Get cost summary for a session
     */
    getSessionCost(sessionId) {
        const sessionCosts = this.costLog.filter(c => c.sessionId === sessionId);
        const byProvider = {};
        for (const cost of sessionCosts) {
            byProvider[cost.provider] = (byProvider[cost.provider] || 0) + cost.costUsd;
        }
        return {
            totalUsd: sessionCosts.reduce((sum, c) => sum + c.costUsd, 0),
            calls: sessionCosts.length,
            byProvider,
        };
    }
    /**
     * Get total cost for all sessions
     */
    getTotalCost() {
        const byProvider = {};
        for (const cost of this.costLog) {
            byProvider[cost.provider] = (byProvider[cost.provider] || 0) + cost.costUsd;
        }
        return {
            totalUsd: this.costLog.reduce((sum, c) => sum + c.costUsd, 0),
            calls: this.costLog.length,
            byProvider,
        };
    }
    /**
     * Get health status of all providers
     */
    getHealth() {
        return Array.from(this.health.values());
    }
    /**
     * Reset provider health
     */
    resetHealth(providerName) {
        const h = this.health.get(providerName);
        if (h) {
            h.available = true;
            h.consecutiveFailures = 0;
            h.lastError = undefined;
        }
    }
    // ============================================
    // Private Helpers
    // ============================================
    buildFallbackChain(preferred) {
        if (!this.options.enableFallback) {
            return [preferred];
        }
        const chain = new Set();
        chain.add(preferred);
        // Add fallback chain in order
        for (const name of this.fallbackChain) {
            if (name !== preferred) {
                chain.add(name);
            }
        }
        return Array.from(chain);
    }
    async withTimeout(promise, ms) {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
            }),
        ]).finally(() => clearTimeout(timer));
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    logCost(cost) {
        this.costLog.push(cost);
        // Trim log if too large
        if (this.costLog.length > 10000) {
            this.costLog = this.costLog.slice(-5000);
        }
    }
    updateHealth(provider, success, durationMs) {
        const h = this.health.get(provider);
        if (!h)
            return;
        h.lastUsed = new Date();
        if (success) {
            h.consecutiveFailures = 0;
            h.available = true;
            if (durationMs !== undefined) {
                // Rolling average
                h.avgResponseTimeMs = h.avgResponseTimeMs === 0
                    ? durationMs
                    : (h.avgResponseTimeMs * 0.8 + durationMs * 0.2);
            }
        }
        else {
            h.consecutiveFailures++;
            if (h.consecutiveFailures >= 3) {
                h.available = false;
                h.lastError = 'Too many consecutive failures';
                logger_1.logger.error('Provider marked unavailable', { provider });
            }
        }
    }
}
exports.ProviderRouter = ProviderRouter;
// ============================================
// Singleton Instance
// ============================================
exports.providerRouter = new ProviderRouter();
