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
import { ZAIProvider } from '../ai/providers/zai.js';
import { ZhipuProvider } from '../ai/providers/zhipu.js';
import { OpenRouterProvider } from '../ai/providers/openrouter.js';
import { OpenAIProvider } from '../ai/providers/openai.js';
import { GigaChatProvider } from '../ai/providers/gigachat.js';
import { YandexGPTProvider } from '../ai/providers/yandexgpt.js';
import { OllamaProvider } from '../ai/providers/ollama.js';
import { estimateTokens } from '../utils/tokens.js';
import { logger } from '../observability/logger.js';
/**
 * C3: Structured HTTP error for providers to throw when the underlying
 * transport returns a status code.  Enables smart 429 / 5xx retry logic.
 */
export class ProviderHttpError extends Error {
    constructor(status, message, 
    /** Retry-After value in seconds (for 429 responses). */
    retryAfter) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
        this.name = 'ProviderHttpError';
    }
}
/**
 * C2: Thrown when the entire streaming fallback chain is exhausted without
 * a successful completion.
 */
export class StreamFailedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StreamFailedError';
    }
}
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
// Circuit-breaker constants
// ============================================
// Applied to breakerCooldownMs: 1× (60 s) → 5× (5 min) → 30× (30 min)
const BREAKER_BACKOFF_MULTIPLIERS = [1, 5, 30];
/** Maximum number of cost-log entries kept in memory (resource-leak guard). */
const COST_LOG_MAX = 1000;
// ============================================
// Provider Router
// ============================================
export class ProviderRouter {
    constructor(options = {}) {
        var _a, _b;
        this.providers = new Map();
        this.health = new Map();
        /** C1: Per-provider circuit-breaker state (only present while blacklisted). */
        this.breakerState = new Map();
        this.costLog = [];
        // Fallback chain priority
        this.fallbackChain = ['zhipu', 'zai', 'openrouter', 'ollama', 'gigachat', 'yandexgpt'];
        this.options = {
            defaultProvider: options.defaultProvider || 'zhipu',
            enableFallback: (_a = options.enableFallback) !== null && _a !== void 0 ? _a : true,
            timeoutMs: options.timeoutMs || 60000,
            maxRetries: options.maxRetries || 2,
            breakerCooldownMs: (_b = options.breakerCooldownMs) !== null && _b !== void 0 ? _b : 60000,
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
     * Chat with automatic fallback.
     * C1: skips blacklisted providers until cooldown expires, then probes (half-open).
     * C3: wraps each call with HTTP-aware 429/5xx retry before generic retry.
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
                    // C1: allow probe once the cooldown window expires (half-open state)
                    const state = this.breakerState.get(providerName);
                    if (!state || Date.now() < state.cooldownUntil) {
                        logger.debug('Skipping provider (circuit open)', { provider: providerName });
                        continue;
                    }
                    logger.debug('Probing provider (half-open)', { provider: providerName });
                }
                for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
                    const startMs = Date.now();
                    try {
                        // C3: HTTP-aware retry wrapper handles 429 / 5xx before the generic loop
                        const response = yield this.callWithHttpRetry(provider, providerName, messages, options);
                        const durationMs = Date.now() - startMs;
                        const outputTokens = estimateTokens(response);
                        const costUsd = estimateCost(providerName, inputTokens, outputTokens);
                        this.logCost({
                            provider: providerName,
                            model: (options === null || options === void 0 ? void 0 : options.model) || provider.models[0] || 'unknown',
                            inputTokens,
                            outputTokens,
                            costUsd,
                            timestamp: new Date(),
                            sessionId: options === null || options === void 0 ? void 0 : options.sessionId,
                        });
                        // C1: success resets circuit breaker
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
                        // Auth failures — skip provider entirely, no retry
                        if (msg.includes('401') || msg.includes('403')) {
                            logger.warn('Provider auth error, skipping', { provider: providerName, error: msg });
                            break;
                        }
                        // Plain-string 429 (no structured Retry-After) — skip provider
                        if (!(error instanceof ProviderHttpError) && msg.includes('429')) {
                            logger.warn('Provider rate-limited, skipping', { provider: providerName });
                            break;
                        }
                        // Structured 4xx (incl. 429 after HTTP retries exhausted) — skip provider
                        if (error instanceof ProviderHttpError && error.status >= 400 && error.status < 500) {
                            logger.warn('Provider 4xx, skipping', { provider: providerName, status: error.status });
                            break;
                        }
                        // Structured 5xx after HTTP retries exhausted — skip provider
                        if (error instanceof ProviderHttpError && error.status >= 500) {
                            logger.warn('Provider 5xx exhausted, skipping', { provider: providerName, status: error.status });
                            break;
                        }
                        logger.warn('Provider attempt failed', {
                            provider: providerName,
                            attempt: attempt + 1,
                            error: msg.slice(0, 200),
                        });
                        if (attempt < this.options.maxRetries - 1) {
                            yield this.delay(this.jitter(500 * (attempt + 1)));
                        }
                    }
                }
                // C1: count this provider as failed (may open circuit on 3rd consecutive failure)
                this.updateHealth(providerName, false);
            }
            throw new Error(`All providers failed. Last error: ${lastError}`);
        });
    }
    /**
     * Stream chat with fallback.
     * C2: if the underlying stream throws mid-response (after yielding ≥1 token),
     * emits a bridge delta '\n[switched provider]\n' then continues on the next provider.
     */
    chatStream(messages, options) {
        return __asyncGenerator(this, arguments, function* chatStream_1() {
            var _a, e_1, _b, _c;
            const preferredProvider = (options === null || options === void 0 ? void 0 : options.provider) || this.options.defaultProvider;
            const chain = this.buildFallbackChain(preferredProvider);
            for (const providerName of chain) {
                const provider = this.providers.get(providerName);
                if (!(provider === null || provider === void 0 ? void 0 : provider.chatStream))
                    continue;
                // C1: respect circuit-breaker in streaming path too
                const health = this.health.get(providerName);
                if (health && !health.available) {
                    const state = this.breakerState.get(providerName);
                    if (!state || Date.now() < state.cooldownUntil)
                        continue;
                }
                let yieldedFromThisProvider = false;
                try {
                    try {
                        for (var _d = true, _e = (e_1 = void 0, __asyncValues(provider.chatStream(messages, options))), _f; _f = yield __await(_e.next()), _a = _f.done, !_a; _d = true) {
                            _c = _f.value;
                            _d = false;
                            const chunk = _c;
                            yieldedFromThisProvider = true;
                            yield yield __await(chunk);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_d && !_a && (_b = _e.return)) yield __await(_b.call(_e));
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    this.updateHealth(providerName, true, 0);
                    return yield __await(void 0);
                }
                catch (error) {
                    logger.warn('Stream provider failed, trying fallback', {
                        provider: providerName,
                        error: String(error).slice(0, 200),
                    });
                    // C2: bridge delta so the caller's buffer isn't left hanging mid-sentence
                    if (yieldedFromThisProvider) {
                        yield yield __await('\n[switched provider]\n');
                    }
                    this.updateHealth(providerName, false);
                }
            }
            throw new StreamFailedError('No streaming providers available');
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
     * Return a copy of the internal cost log, optionally limited to the last
     * `limit` entries.
     */
    getCostLog(limit) {
        return limit === undefined ? [...this.costLog] : this.costLog.slice(-limit);
    }
    /**
     * Get health status of all providers
     */
    getHealth() {
        return Array.from(this.health.values());
    }
    /**
     * Reset provider health (also clears the C1 circuit-breaker state).
     */
    resetHealth(providerName) {
        const h = this.health.get(providerName);
        if (h) {
            h.available = true;
            h.consecutiveFailures = 0;
            h.lastError = undefined;
        }
        this.breakerState.delete(providerName);
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
        for (const name of this.fallbackChain) {
            if (name !== preferred) {
                chain.add(name);
            }
        }
        return Array.from(chain);
    }
    /**
     * C3: Wrap a single provider call with HTTP-aware retry.
     * - 429 (ProviderHttpError): wait Retry-After (default 1 s) then retry — up to 2 retries.
     * - 5xx (ProviderHttpError): exponential back-off 250 ms → 1 000 ms — up to 2 retries.
     * - All other errors are re-thrown immediately for the outer loop to handle.
     */
    callWithHttpRetry(provider, providerName, messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const MAX_HTTP_RETRIES = 2;
            let httpRetry = 0;
            for (;;) {
                try {
                    return yield this.withTimeout(provider.chat(messages, Object.assign(Object.assign({}, options), { provider: providerName })), this.options.timeoutMs);
                }
                catch (error) {
                    if (error instanceof ProviderHttpError) {
                        if (error.status === 429 && httpRetry < MAX_HTTP_RETRIES) {
                            const waitMs = ((_a = error.retryAfter) !== null && _a !== void 0 ? _a : 1) * 1000;
                            logger.warn('Provider 429, waiting Retry-After', { provider: providerName, waitMs, attempt: httpRetry + 1 });
                            yield this.delay(this.jitter(waitMs));
                            httpRetry++;
                            continue;
                        }
                        if (error.status >= 500 && httpRetry < MAX_HTTP_RETRIES) {
                            const waitMs = httpRetry === 0 ? 250 : 1000;
                            logger.warn('Provider 5xx, backing off', { provider: providerName, waitMs, attempt: httpRetry + 1 });
                            yield this.delay(this.jitter(waitMs));
                            httpRetry++;
                            continue;
                        }
                    }
                    throw error;
                }
            }
        });
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
    /** Add ±20 % jitter to a delay to avoid thundering-herd on retries. */
    jitter(ms) {
        return Math.floor(ms * (0.8 + Math.random() * 0.4));
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    logCost(cost) {
        this.costLog.push(cost);
        // Resource-leak guard: keep only the most recent COST_LOG_MAX entries
        if (this.costLog.length > COST_LOG_MAX) {
            this.costLog.shift();
        }
    }
    updateHealth(provider, success, durationMs) {
        var _a;
        const h = this.health.get(provider);
        if (!h)
            return;
        h.lastUsed = new Date();
        if (success) {
            h.consecutiveFailures = 0;
            h.available = true;
            // C1: full circuit-breaker reset on any successful response
            this.breakerState.delete(provider);
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
                // C1: set / refresh exponential back-off cooldown for circuit breaker
                const state = (_a = this.breakerState.get(provider)) !== null && _a !== void 0 ? _a : { cooldownUntil: 0, backoffCount: 0 };
                const idx = Math.min(state.backoffCount, BREAKER_BACKOFF_MULTIPLIERS.length - 1);
                state.cooldownUntil = Date.now() + this.options.breakerCooldownMs * BREAKER_BACKOFF_MULTIPLIERS[idx];
                state.backoffCount++;
                this.breakerState.set(provider, state);
                logger.error('Provider circuit open', {
                    provider,
                    cooldownUntil: new Date(state.cooldownUntil).toISOString(),
                    backoffCount: state.backoffCount,
                });
            }
        }
    }
}
// ============================================
// Singleton Instance
// ============================================
export const providerRouter = new ProviderRouter();
