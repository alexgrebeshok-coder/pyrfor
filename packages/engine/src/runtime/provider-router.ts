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
// Types
// ============================================

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
export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Retry-After value in seconds (for 429 responses). */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/**
 * C2: Thrown when the entire streaming fallback chain is exhausted without
 * a successful completion.
 */
export class StreamFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamFailedError';
  }
}

// ============================================
// Cost Estimation
// ============================================

// Rough cost per 1K tokens (input / output) in USD
const COST_RATES: Record<string, { input: number; output: number }> = {
  zai: { input: 0.0005, output: 0.0015 }, // Very cheap
  openrouter: { input: 0.002, output: 0.006 }, // Variable, using average
  openai: { input: 0.003, output: 0.006 }, // GPT-4o-mini rates
  ollama: { input: 0, output: 0 }, // Free (local)
};

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_RATES[provider] || COST_RATES.openrouter;
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

// ============================================
// Circuit-breaker constants
// ============================================

// Applied to breakerCooldownMs: 1× (60 s) → 5× (5 min) → 30× (30 min)
const BREAKER_BACKOFF_MULTIPLIERS = [1, 5, 30] as const;

/** Maximum number of cost-log entries kept in memory (resource-leak guard). */
const COST_LOG_MAX = 1000;

// ============================================
// Internal types
// ============================================

interface BreakerState {
  cooldownUntil: number;
  backoffCount: number;
}

// ============================================
// Provider Router
// ============================================

export class ProviderRouter {
  private providers: Map<string, AIProvider> = new Map();
  private health: Map<string, ProviderHealth> = new Map();
  /** C1: Per-provider circuit-breaker state (only present while blacklisted). */
  private breakerState: Map<string, BreakerState> = new Map();
  private costLog: ProviderCost[] = [];
  private options: Required<ProviderRouterOptions>;

  // Fallback chain priority
  private fallbackChain: string[] = ['zhipu', 'zai', 'openrouter', 'ollama', 'gigachat', 'yandexgpt'];

  constructor(options: ProviderRouterOptions = {}) {
    this.options = {
      defaultProvider: options.defaultProvider || 'zhipu',
      enableFallback: options.enableFallback ?? true,
      timeoutMs: options.timeoutMs || 60000,
      maxRetries: options.maxRetries || 2,
      breakerCooldownMs: options.breakerCooldownMs ?? 60_000,
    };

    this.initializeProviders();
  }

  /**
   * Initialize available providers from environment
   */
  private initializeProviders(): void {
    // Zhipu AI (api.z.ai) — primary, direct access
    if (process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY) {
      try {
        const zhipu = new ZhipuProvider(process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY);
        this.register('zhipu', zhipu);
      } catch (error) {
        logger.warn('Failed to initialize Zhipu provider', { error: String(error) });
      }
    }

    // ZAI (ZukiJourney proxy) — fallback
    if (process.env.ZAI_API_KEY && process.env.ZAI_API_KEY !== process.env.ZHIPU_API_KEY) {
      try {
        const zai = new ZAIProvider();
        this.register('zai', zai);
      } catch (error) {
        logger.warn('Failed to initialize ZAI provider', { error: String(error) });
      }
    }

    // OpenRouter - fallback with many models
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const openrouter = new OpenRouterProvider();
        this.register('openrouter', openrouter);
      } catch (error) {
        logger.warn('Failed to initialize OpenRouter provider', { error: String(error) });
      }
    }

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAIProvider();
        this.register('openai', openai);
      } catch (error) {
        logger.warn('Failed to initialize OpenAI provider', { error: String(error) });
      }
    }

    // Ollama (local) - always available but might not be running
    this.register('ollama', new OllamaProvider());

    // Russian providers
    if (process.env.GIGACHAT_API_KEY) {
      try {
        this.register('gigachat', new GigaChatProvider());
      } catch (error) {
        logger.warn('Failed to initialize GigaChat provider', { error: String(error) });
      }
    }

    if (process.env.YANDEX_API_KEY) {
      try {
        this.register('yandexgpt', new YandexGPTProvider());
      } catch (error) {
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
  register(name: string, provider: AIProvider): void {
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
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys()).filter(name => {
      const h = this.health.get(name);
      return h?.available !== false && (h?.consecutiveFailures ?? 0) < 3;
    });
  }

  /**
   * Check if we have any available providers
   */
  hasAvailableProvider(): boolean {
    return this.getAvailableProviders().length > 0;
  }

  /**
   * Chat with automatic fallback.
   * C1: skips blacklisted providers until cooldown expires, then probes (half-open).
   * C3: wraps each call with HTTP-aware 429/5xx retry before generic retry.
   */
  async chat(messages: Message[], options?: ChatOptions & { sessionId?: string }): Promise<string> {
    const preferredProvider = options?.provider || this.options.defaultProvider;
    const chain = this.buildFallbackChain(preferredProvider);

    const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    let lastError = '';

    for (const providerName of chain) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

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
          const response = await this.callWithHttpRetry(provider, providerName, messages, options);

          const durationMs = Date.now() - startMs;
          const outputTokens = estimateTokens(response);
          const costUsd = estimateCost(providerName, inputTokens, outputTokens);

          this.logCost({
            provider: providerName,
            model: options?.model || provider.models[0] || 'unknown',
            inputTokens,
            outputTokens,
            costUsd,
            timestamp: new Date(),
            sessionId: options?.sessionId,
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

        } catch (error) {
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
            await this.delay(this.jitter(500 * (attempt + 1)));
          }
        }
      }

      // C1: count this provider as failed (may open circuit on 3rd consecutive failure)
      this.updateHealth(providerName, false);
    }

    throw new Error(`All providers failed. Last error: ${lastError}`);
  }

  /**
   * Stream chat with fallback.
   * C2: if the underlying stream throws mid-response (after yielding ≥1 token),
   * emits a bridge delta '\n[switched provider]\n' then continues on the next provider.
   */
  async *chatStream(
    messages: Message[],
    options?: ChatOptions & { sessionId?: string }
  ): AsyncGenerator<string, void, unknown> {
    const preferredProvider = options?.provider || this.options.defaultProvider;
    const chain = this.buildFallbackChain(preferredProvider);

    for (const providerName of chain) {
      const provider = this.providers.get(providerName);
      if (!provider?.chatStream) continue;

      // C1: respect circuit-breaker in streaming path too
      const health = this.health.get(providerName);
      if (health && !health.available) {
        const state = this.breakerState.get(providerName);
        if (!state || Date.now() < state.cooldownUntil) continue;
      }

      let yieldedFromThisProvider = false;
      try {
        for await (const chunk of provider.chatStream(messages, options)) {
          yieldedFromThisProvider = true;
          yield chunk;
        }
        this.updateHealth(providerName, true, 0);
        return;
      } catch (error) {
        logger.warn('Stream provider failed, trying fallback', {
          provider: providerName,
          error: String(error).slice(0, 200),
        });
        // C2: bridge delta so the caller's buffer isn't left hanging mid-sentence
        if (yieldedFromThisProvider) {
          yield '\n[switched provider]\n';
        }
        this.updateHealth(providerName, false);
      }
    }

    throw new StreamFailedError('No streaming providers available');
  }

  /**
   * Get cost summary for a session
   */
  getSessionCost(sessionId: string): { totalUsd: number; calls: number; byProvider: Record<string, number> } {
    const sessionCosts = this.costLog.filter(c => c.sessionId === sessionId);
    const byProvider: Record<string, number> = {};

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
  getTotalCost(): { totalUsd: number; calls: number; byProvider: Record<string, number> } {
    const byProvider: Record<string, number> = {};

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
  getCostLog(limit?: number): ProviderCost[] {
    return limit === undefined ? [...this.costLog] : this.costLog.slice(-limit);
  }

  /**
   * Get health status of all providers
   */
  getHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Reset provider health (also clears the C1 circuit-breaker state).
   */
  resetHealth(providerName: string): void {
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

  private buildFallbackChain(preferred: string): string[] {
    if (!this.options.enableFallback) {
      return [preferred];
    }

    const chain = new Set<string>();
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
  private async callWithHttpRetry(
    provider: AIProvider,
    providerName: string,
    messages: Message[],
    options?: ChatOptions & { sessionId?: string },
  ): Promise<string> {
    const MAX_HTTP_RETRIES = 2;
    let httpRetry = 0;

    for (;;) {
      try {
        return await this.withTimeout(
          provider.chat(messages, { ...options, provider: providerName }),
          this.options.timeoutMs,
        );
      } catch (error) {
        if (error instanceof ProviderHttpError) {
          if (error.status === 429 && httpRetry < MAX_HTTP_RETRIES) {
            const waitMs = (error.retryAfter ?? 1) * 1000;
            logger.warn('Provider 429, waiting Retry-After', { provider: providerName, waitMs, attempt: httpRetry + 1 });
            await this.delay(this.jitter(waitMs));
            httpRetry++;
            continue;
          }
          if (error.status >= 500 && httpRetry < MAX_HTTP_RETRIES) {
            const waitMs = httpRetry === 0 ? 250 : 1000;
            logger.warn('Provider 5xx, backing off', { provider: providerName, waitMs, attempt: httpRetry + 1 });
            await this.delay(this.jitter(waitMs));
            httpRetry++;
            continue;
          }
        }
        throw error;
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Add ±20 % jitter to a delay to avoid thundering-herd on retries. */
  private jitter(ms: number): number {
    return Math.floor(ms * (0.8 + Math.random() * 0.4));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private logCost(cost: ProviderCost): void {
    this.costLog.push(cost);
    // Resource-leak guard: keep only the most recent COST_LOG_MAX entries
    if (this.costLog.length > COST_LOG_MAX) {
      this.costLog.shift();
    }
  }

  private updateHealth(provider: string, success: boolean, durationMs?: number): void {
    const h = this.health.get(provider);
    if (!h) return;

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
    } else {
      h.consecutiveFailures++;
      if (h.consecutiveFailures >= 3) {
        h.available = false;
        h.lastError = 'Too many consecutive failures';

        // C1: set / refresh exponential back-off cooldown for circuit breaker
        const state = this.breakerState.get(provider) ?? { cooldownUntil: 0, backoffCount: 0 };
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
