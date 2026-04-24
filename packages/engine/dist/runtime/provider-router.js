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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncDelegator = (this && this.__asyncDelegator) || function (o) {
    var i, p;
    return i = {}, verb("next"), verb("throw", function (e) { throw e; }), verb("return"), i[Symbol.iterator] = function () { return this; }, i;
    function verb(n, f) { i[n] = o[n] ? function (v) { return (p = !p) ? { value: __await(o[n](v)), done: false } : f ? f(v) : v; } : f; }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { ZAIProvider } from '../ai/providers/zai';
import { ZhipuProvider } from '../ai/providers/zhipu';
import { OpenRouterProvider } from '../ai/providers/openrouter';
import { OpenAIProvider } from '../ai/providers/openai';
import { GigaChatProvider } from '../ai/providers/gigachat';
import { YandexGPTProvider } from '../ai/providers/yandexgpt';
import { OllamaProvider } from '../ai/providers/ollama';
import { estimateTokens } from '../utils/tokens';
import { logger } from '../observability/logger';
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
export class ProviderRouter {
    constructor(options = {}) {
        var _a;
        this.providers = new Map();
        this.health = new Map();
        this.costLog = [];
        // Fallback chain priority
        this.fallbackChain = ['zhipu', 'zai', 'openrouter', 'ollama', 'gigachat', 'yandexgpt'];
        this.options = {
            defaultProvider: options.defaultProvider || 'zhipu',
            enableFallback: (_a = options.enableFallback) !== null && _a !== void 0 ? _a : true,
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
                const zhipu = new ZhipuProvider(process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY);
                this.register('zhipu', zhipu);
            }
            catch (error) {
                logger.warn('Failed to initialize Zhipu provider', { error: String(error) });
            }
        }
        // ZAI (ZukiJourney proxy) — fallback
        if (process.env.ZAI_API_KEY && process.env.ZAI_API_KEY !== process.env.ZHIPU_API_KEY) {
            try {
                const zai = new ZAIProvider();
                this.register('zai', zai);
            }
            catch (error) {
                logger.warn('Failed to initialize ZAI provider', { error: String(error) });
            }
        }
        // OpenRouter - fallback with many models
        if (process.env.OPENROUTER_API_KEY) {
            try {
                const openrouter = new OpenRouterProvider();
                this.register('openrouter', openrouter);
            }
            catch (error) {
                logger.warn('Failed to initialize OpenRouter provider', { error: String(error) });
            }
        }
        // OpenAI
        if (process.env.OPENAI_API_KEY) {
            try {
                const openai = new OpenAIProvider();
                this.register('openai', openai);
            }
            catch (error) {
                logger.warn('Failed to initialize OpenAI provider', { error: String(error) });
            }
        }
        // Ollama (local) - always available but might not be running
        this.register('ollama', new OllamaProvider());
        // Russian providers
        if (process.env.GIGACHAT_API_KEY) {
            try {
                this.register('gigachat', new GigaChatProvider());
            }
            catch (error) {
                logger.warn('Failed to initialize GigaChat provider', { error: String(error) });
            }
        }
        if (process.env.YANDEX_API_KEY) {
            try {
                this.register('yandexgpt', new YandexGPTProvider());
            }
            catch (error) {
                logger.warn('Failed to initialize YandexGPT provider', { error: String(error) });
            }
        }
        logger.info('Provider router initialized', {
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
            var _a;
            const h = this.health.get(name);
            return (h === null || h === void 0 ? void 0 : h.available) !== false && ((_a = h === null || h === void 0 ? void 0 : h.consecutiveFailures) !== null && _a !== void 0 ? _a : 0) < 3;
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
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const preferredProvider = (options === null || options === void 0 ? void 0 : options.provider) || this.options.defaultProvider;
            const chain = this.buildFallbackChain(preferredProvider);
            const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            let lastError = '';
            for (const providerName of chain) {
                const provider = this.providers.get(providerName);
                if (!provider)
                    continue;
                const health = this.health.get(providerName);
                if (health && !health.available) {
                    logger.debug('Skipping unavailable provider', { provider: providerName });
                    continue;
                }
                for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
                    const startMs = Date.now();
                    try {
                        // Use timeout wrapper
                        const response = yield this.withTimeout(provider.chat(messages, Object.assign(Object.assign({}, options), { provider: providerName })), this.options.timeoutMs);
                        const durationMs = Date.now() - startMs;
                        const outputTokens = estimateTokens(response);
                        const costUsd = estimateCost(providerName, inputTokens, outputTokens);
                        // Log success
                        this.logCost({
                            provider: providerName,
                            model: (options === null || options === void 0 ? void 0 : options.model) || provider.models[0] || 'unknown',
                            inputTokens,
                            outputTokens,
                            costUsd,
                            timestamp: new Date(),
                            sessionId: options === null || options === void 0 ? void 0 : options.sessionId,
                        });
                        // Update health
                        this.updateHealth(providerName, true, durationMs);
                        logger.debug('Provider succeeded', {
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
                            logger.warn('Provider auth/rate error, skipping retry', {
                                provider: providerName,
                                error: msg,
                            });
                            break;
                        }
                        logger.warn('Provider attempt failed', {
                            provider: providerName,
                            attempt: attempt + 1,
                            error: msg.slice(0, 200),
                        });
                        if (attempt < this.options.maxRetries - 1) {
                            yield this.delay(500 * (attempt + 1));
                        }
                    }
                }
                // Mark provider as potentially having issues
                this.updateHealth(providerName, false);
            }
            throw new Error(`All providers failed. Last error: ${lastError}`);
        });
    }
    /**
     * Stream chat with fallback
     */
    chatStream(messages, options) {
        return __asyncGenerator(this, arguments, function* chatStream_1() {
            const preferredProvider = (options === null || options === void 0 ? void 0 : options.provider) || this.options.defaultProvider;
            const chain = this.buildFallbackChain(preferredProvider);
            for (const providerName of chain) {
                const provider = this.providers.get(providerName);
                if (!(provider === null || provider === void 0 ? void 0 : provider.chatStream))
                    continue;
                try {
                    yield __await(yield* __asyncDelegator(__asyncValues(provider.chatStream(messages, options))));
                    this.updateHealth(providerName, true, 0);
                    return yield __await(void 0);
                }
                catch (error) {
                    logger.warn('Stream provider failed, trying fallback', {
                        provider: providerName,
                        error: String(error).slice(0, 200),
                    });
                    this.updateHealth(providerName, false);
                }
            }
            throw new Error('No streaming providers available');
        });
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
    withTimeout(promise, ms) {
        return __awaiter(this, void 0, void 0, function* () {
            let timer;
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
                }),
            ]).finally(() => clearTimeout(timer));
        });
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
                logger.error('Provider marked unavailable', { provider });
            }
        }
    }
}
// ============================================
// Singleton Instance
// ============================================
export const providerRouter = new ProviderRouter();
