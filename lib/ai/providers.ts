/**
 * AI Providers - Multi-provider support
 * OpenRouter + ZAI + OpenAI
 */

import "server-only";

import { logger } from "@/lib/logger";
import {
  createConfiguredAIProvider,
  loadConfiguredAIProviderManifests,
} from "@/lib/ai/provider-manifests";
import { getCircuitBreaker, CircuitOpenError } from "@/lib/ai/circuit-breaker";
import { buildCostRecorder, checkCostBudget } from "@/lib/ai/cost-tracker";

// ============================================
// DNS Cache (5 min TTL — avoid per-request resolve4 calls)
// ============================================

const _dnsCache = new Map<string, { ip: string; expiresAt: number }>();
const DNS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PROVIDER_TIMEOUT_MS = 30_000;
const CIRCUIT_TIMEOUT_MS = 45_000;
const STREAM_MAX_QUEUE_SIZE = 100;

function getCachedIPv4(hostname: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dns = require('dns') as typeof import('dns');
  const cached = _dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.ip);
  }
  return new Promise((resolve) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) {
        // Fallback to hostname — still better than crashing
        return resolve(hostname);
      }
      _dnsCache.set(hostname, { ip: addresses[0], expiresAt: Date.now() + DNS_TTL_MS });
      resolve(addresses[0]);
    });
  });
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Merge external signal with timeout signal
    const fetchInit = { ...init };
    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new Error('Request aborted');
      }
      // Listen for external abort and destroy timeout controller
      externalSignal.addEventListener('abort', () => {
        controller.abort();
      }, { once: true });
    }
    return await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// Transient error classification
// ============================================

/**
 * Identify errors that should trigger AIRouter cross-provider fallback
 * instead of bubbling up to the caller. Covers:
 *  - explicit provider-level failures ("API error", "not set", "not available")
 *  - network/DNS/socket errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, socket hang up)
 *  - timeouts and aborts
 *  - 5xx-class error messages surfaced by providers
 *  - anything tagged with `transient: true` (see OpenRouter httpsPost)
 */
export function isTransientProviderError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null && (err as { transient?: boolean }).transient === true) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (!message) return false;
  const lc = message.toLowerCase();

  // Explicit provider-level failures
  if (
    lc.includes("api error") ||
    lc.includes("not set") ||
    lc.includes("not available") ||
    lc.includes("all models exhausted")
  ) {
    return true;
  }

  // Network/DNS/socket
  if (
    lc.includes("econnreset") ||
    lc.includes("etimedout") ||
    lc.includes("enotfound") ||
    lc.includes("eai_again") ||
    lc.includes("socket hang up") ||
    lc.includes("network error") ||
    lc.includes("network failure") ||
    lc.includes("fetch failed")
  ) {
    return true;
  }

  // Timeouts / aborts
  if (lc.includes("timeout") || lc.includes("aborted")) return true;

  // 5xx-class status embedded in the message
  if (/\b5\d{2}\b/.test(message)) return true;

  return false;
}

// ============================================
// Types
// ============================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * OpenAI-compatible tool definition used for native function-calling paths.
 * Shape matches `lib/ai/tools.ts#AIToolDefinition` so providers can forward
 * it verbatim into their request body.
 */
export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatWithToolsOptions extends ChatOptions {
  tools: readonly ProviderToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
}

export interface ChatWithToolsResult {
  /** Assistant content — may be empty when the model only emitted tool calls. */
  content: string;
  /** Structured tool calls extracted from the provider's native response. */
  toolCalls: ProviderToolCall[];
  /** Convenience flag indicating whether any tool calls were produced. */
  hasToolCalls: boolean;
  /** Model actually used (providers may fall back inside the provider). */
  model: string;
  /** finish_reason surfaced by the provider, if any. */
  finishReason?: string;
}

export interface AIProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
  /**
   * Optional native tool-calling path. Providers that implement this return
   * structured tool calls from the model's response, avoiding brittle
   * text/JSON parsing. Providers without function-calling capability should
   * simply not implement this method — callers can fall back to `.chat()`
   * and parse tool calls from the string.
   */
  chatWithTools?(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResult>;
  /**
   * Whether this provider supports native tool calling. Used by the router
   * to decide which provider to route a tool-enabled request to first.
   */
  supportsToolCalls?: boolean;
}

// ============================================
// OpenRouter Provider
// ============================================

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models = [
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'google/gemma-3-27b-it:free',
    'google/gemma-3-12b-it:free',
    'google/gemma-3-4b-it:free',
    'openai/gpt-4o-mini',
  ];

  /** Models on OpenRouter that reliably support OpenAI-compatible tool calls. */
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
  ]);

  supportsToolCalls = true;

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  /**
   * Low-level POST using Node's https module to avoid undici/IPv6 DNS issues
   * inside Next.js. Returns the structured response directly so callers
   * don't pay a JSON stringify/parse round-trip.
   *
   * Network failures (ECONNRESET, ETIMEDOUT, socket hang up, DNS errors) are
   * reject()ed with the original error message preserved so the AIRouter
   * fallback chain can recognise them as transient provider failures.
   */
  private async httpsPost(payload: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const host = await getCachedIPv4('openrouter.ai');
    return new Promise((resolve, reject) => {
      const body = Buffer.from(payload);
      let resRef: import('http').IncomingMessage | null = null;
      const req = https.request(
        {
          hostname: host,
          port: 443,
          path: '/api/v1/chat/completions',
          method: 'POST',
          servername: 'openrouter.ai', // required for TLS SNI when using IP
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://ceoclaw.com',
            'X-Title': 'CEOClaw',
            Host: 'openrouter.ai',
            'Content-Length': body.length,
          },
        },
        (res) => {
          resRef = res;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', (err: Error) => {
            reject(
              Object.assign(new Error(`OpenRouter response stream error: ${err.message}`), {
                cause: err,
                transient: true,
              })
            );
          });
        }
      );
      req.setTimeout(PROVIDER_TIMEOUT_MS, () => {
        req.destroy(
          Object.assign(new Error(`OpenRouter request timeout after ${PROVIDER_TIMEOUT_MS}ms`), {
            transient: true,
          })
        );
      });
      req.on('error', (err: Error) => {
        reject(
          Object.assign(new Error(`OpenRouter network error: ${err.message}`), {
            cause: err,
            transient: true,
          })
        );
      });
      req.on('close', () => {
        resRef?.removeAllListeners();
        req.removeAllListeners();
      });
      if (signal) {
        if (signal.aborted) {
          req.destroy(new Error('Request aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          req.destroy(new Error('Request aborted'));
        }, { once: true });
      }
      req.write(body);
      req.end();
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    const requestedModel = options?.model || this.models[0];
    const fallbackChain = [requestedModel, ...this.models.filter((m) => m !== requestedModel)];
    let lastError = '';

    for (const model of fallbackChain) {
      // Gemma models don't support system messages — merge into user message
      const preparedMessages = model.includes('gemma') ? this.mergeSystemIntoUser(messages) : messages;

      let status = 0;
      let body = '';
      try {
        ({ status, body } = await this.httpsPost(
          JSON.stringify({
            model,
            messages: preparedMessages,
            temperature: options?.temperature || 0.7,
            max_tokens: options?.maxTokens || 4096,
          }),
          options?.signal
        ));
      } catch (networkErr) {
        // Network-level failure: propagate with a prefix AIRouter recognises
        // so the cross-provider fallback chain fires instead of bubbling up.
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        logger.warn('OpenRouter network failure, trying next in-provider model', {
          model,
          reason: msg.slice(0, 160),
        });
        lastError = msg;
        continue;
      }

      if (status >= 200 && status < 300) {
        try {
          const data = JSON.parse(body);
          const content = data?.choices?.[0]?.message?.content;
          if (typeof content !== 'string') {
            throw new Error(`OpenRouter API error: invalid response shape for model ${model}`);
          }
          return content;
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          throw new Error(`OpenRouter API error: failed to parse response: ${msg}`);
        }
      }

      // Broadened retry policy: rate-limit, Gemma-specific "Developer instruction"
      // 400, all 5xx, and any 408-series transient status should fall through.
      const isRateLimit = status === 429;
      const isGemma400 = status === 400 && body.includes('Developer instruction');
      const isServerError = status >= 500 && status <= 599;
      const isTimeoutLike = status === 408 || status === 425 || status === 423;
      const shouldRetry = isRateLimit || isGemma400 || isServerError || isTimeoutLike;

      if (!shouldRetry) {
        throw new Error(`OpenRouter API error: ${status} - ${body.slice(0, 400)}`);
      }

      logger.warn('OpenRouter model fallback', {
        model,
        status,
        reason: isRateLimit ? 'rate-limit' : isGemma400 ? 'gemma-system' : 'transient',
      });
      lastError = body;
    }

    // Final error message explicitly marked as a provider-level error so the
    // AIRouter fallback (next provider) can kick in.
    throw new Error(`OpenRouter API error: all models exhausted. Last error: ${lastError.slice(0, 400)}`);
  }

  /**
   * Native OpenAI-compatible tool-calling path. Forwards the model-provided
   * `tools` array and returns structured tool calls instead of asking the
   * caller to parse JSON out of free text.
   *
   * Falls back across tool-capable models only — if the preferred model is
   * not in `toolCapableModels`, we prefer `openai/gpt-4o-mini` which is the
   * cheapest reliable OpenRouter tool-calling model at time of writing.
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    const requested = options.model || 'openai/gpt-4o-mini';
    const primary = this.toolCapableModels.has(requested) ? requested : 'openai/gpt-4o-mini';
    const fallback = Array.from(this.toolCapableModels).filter((m) => m !== primary);
    const chain = [primary, ...fallback];

    let lastError = '';
    for (const model of chain) {
      let status = 0;
      let body = '';
      try {
        ({ status, body } = await this.httpsPost(
          JSON.stringify({
            model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            tools: options.tools,
            tool_choice: options.toolChoice ?? 'auto',
          })
        ));
      } catch (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        logger.warn('OpenRouter tool-call network failure, trying next model', {
          model,
          reason: msg.slice(0, 160),
        });
        lastError = msg;
        continue;
      }

      if (status >= 200 && status < 300) {
        try {
          const data = JSON.parse(body);
          const choice = data?.choices?.[0];
          const rawToolCalls = choice?.message?.tool_calls;
          const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
          const toolCalls: ProviderToolCall[] = Array.isArray(rawToolCalls)
            ? rawToolCalls
                .filter(
                  (tc: unknown): tc is { id: string; function: { name: string; arguments: unknown } } =>
                    !!tc &&
                    typeof tc === 'object' &&
                    typeof (tc as { id?: unknown }).id === 'string' &&
                    !!(tc as { function?: unknown }).function &&
                    typeof ((tc as { function: { name?: unknown } }).function.name) === 'string'
                )
                .map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.function.name,
                    arguments:
                      typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments ?? {}),
                  },
                }))
            : [];

          return {
            content,
            toolCalls,
            hasToolCalls: toolCalls.length > 0,
            model,
            finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
          };
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          throw new Error(`OpenRouter API error: failed to parse tool-call response: ${msg}`);
        }
      }

      const isRateLimit = status === 429;
      const isServerError = status >= 500 && status <= 599;
      if (!(isRateLimit || isServerError)) {
        throw new Error(`OpenRouter API error: ${status} - ${body.slice(0, 400)}`);
      }
      logger.warn('OpenRouter tool-call model fallback', {
        model,
        status,
        reason: isRateLimit ? 'rate-limit' : 'server-error',
      });
      lastError = body;
    }

    throw new Error(
      `OpenRouter API error: all tool-capable models exhausted. Last error: ${lastError.slice(0, 400)}`
    );
  }

  /** Stream tokens from OpenRouter as an async generator */
  async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not set');

    const requestedModel = options?.model || this.models[0];
    const fallbackChain = [requestedModel, ...this.models.filter(m => m !== requestedModel)];

    for (const model of fallbackChain) {
      let yieldedAny = false;
      try {
        for await (const chunk of this._streamModel(messages, model)) {
          yieldedAny = true;
          yield chunk;
        }
        return; // success — stop fallback chain
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRetryable = !yieldedAny && msg.includes('retryable');
        if (!isRetryable) throw err;
        logger.warn('chatStream fallback', { model, reason: msg.slice(0, 100) });
      }
    }

    throw new Error('chatStream: all models exhausted');
  }

  /** Inner streaming method for a single model (used by chatStream fallback) */
  private async *_streamModel(messages: Message[], model: string): AsyncGenerator<string, void, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const host = await getCachedIPv4('openrouter.ai');
    const preparedMessages = model.includes('gemma')
      ? this.mergeSystemIntoUser(messages)
      : messages;

    // Queue + notification pattern for bridging Node.js streams → async generator
    const queue: string[] = [];
    let streamDone = false;
    let streamError: Error | null = null;
    const wakeQueue: Array<() => void> = [];
    let resRef: import('http').IncomingMessage | null = null;
    let cleanedUp = false;
    let streamPaused = false;
    const notify = () => {
      const cb = wakeQueue.shift();
      cb?.();
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      streamDone = true;
      resRef?.removeAllListeners();
      req.removeAllListeners();
      if (!req.destroyed) {
        req.destroy();
      }
    };

    const body = Buffer.from(JSON.stringify({
      model,
      messages: preparedMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }));

    const req = https.request({
      hostname: host,
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      servername: 'openrouter.ai',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://ceoclaw.com',
        'X-Title': 'CEOClaw',
        'Host': 'openrouter.ai',
        'Content-Length': body.length,
      },
    }, (res: import('http').IncomingMessage) => {
      resRef = res;
      // On non-200: collect body and throw as error
      if ((res.statusCode ?? 0) >= 400) {
        let errBody = '';
        res.on('data', (c: Buffer) => { errBody += c.toString(); });
        res.on('end', () => {
          const isRetryable = res.statusCode === 429 || (res.statusCode === 400 && errBody.includes('Developer instruction'));
          streamError = new Error(`OpenRouter stream error ${res.statusCode}${isRetryable ? ' (retryable)' : ''}: ${errBody.slice(0, 200)}`);
          streamDone = true;
          notify();
        });
        return;
      }

      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { streamDone = true; notify(); return; }
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              queue.push(content);
              if (!streamPaused && queue.length >= STREAM_MAX_QUEUE_SIZE) {
                streamPaused = true;
                res.pause();
              }
              notify();
            }
          } catch { /* skip malformed SSE line */ }
        }
      });
      res.on('end', () => { streamDone = true; notify(); });
      res.on('error', (err: Error) => { streamError = err; streamDone = true; notify(); });
    });
    req.on('error', (err: Error) => { streamError = err; streamDone = true; notify(); });
    req.setTimeout(PROVIDER_TIMEOUT_MS, () => {
      streamError = new Error(`Request timeout after ${PROVIDER_TIMEOUT_MS}ms`);
      streamDone = true;
      cleanup();
      notify();
    });
    req.write(body);
    req.end();

    try {
      while (!streamDone || queue.length > 0) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (streamPaused && queue.length < Math.floor(STREAM_MAX_QUEUE_SIZE / 2)) {
            streamPaused = false;
            (resRef as ({ resume?: () => void } | null))?.resume?.();
          }
          if (next) {
            yield next;
          }
        } else if (!streamDone) {
          await new Promise<void>((resolve) => {
            wakeQueue.push(resolve);
          });
        }
        if (streamError) throw streamError;
      }
    } finally {
      cleanup();
    }
  }

  /** Merge system messages into the first user message for models that don't support system role */
  private mergeSystemIntoUser(messages: Message[]): Message[] {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');
    if (systemMsgs.length === 0) return messages;
    const systemContext = systemMsgs.map(m => m.content).join('\n\n');
    const firstUser = otherMsgs[0];
    if (!firstUser) return [{ role: 'user', content: systemContext }];
    return [
      { ...firstUser, content: `${systemContext}\n\n${firstUser.content}` },
      ...otherMsgs.slice(1),
    ];
  }
}

// ============================================
// Shared OpenAI-compatible tool-call helper
// ============================================

/**
 * Shared implementation of `chatWithTools` for every OpenAI-compatible
 * provider (ZAI, OpenAI, AIJora, Polza, Bothub). Chooses a tool-capable
 * model from the provider's own allow-list, forwards the OpenAI `tools` +
 * `tool_choice` fields verbatim, and normalises the response to
 * `ChatWithToolsResult`.
 *
 * Network/5xx/429 trigger an in-provider model fallback; a terminal failure
 * throws an error whose message is recognised by `AIRouter.chatWithTools`
 * so the cross-provider fallback chain can kick in.
 */
async function openAICompatibleChatWithTools(params: {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  messages: Message[];
  options: ChatWithToolsOptions;
  toolCapableModels: ReadonlySet<string>;
  defaultModel: string;
  authHeader?: (apiKey: string) => Record<string, string>;
}): Promise<ChatWithToolsResult> {
  const {
    providerName,
    baseUrl,
    apiKey,
    messages,
    options,
    toolCapableModels,
    defaultModel,
    authHeader,
  } = params;

  if (!apiKey) {
    throw new Error(`${providerName.toUpperCase()}_API_KEY not set`);
  }

  const requested = options.model ?? defaultModel;
  const primary = toolCapableModels.has(requested) ? requested : defaultModel;
  const fallback = Array.from(toolCapableModels).filter((m) => m !== primary);
  const chain = [primary, ...fallback];

  const headers: Record<string, string> = authHeader
    ? { 'Content-Type': 'application/json', ...authHeader(apiKey) }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  let lastError = '';
  for (const model of chain) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 4096,
          tools: options.tools,
          tool_choice: options.toolChoice ?? 'auto',
        }),
      });
    } catch (networkErr) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      logger.warn(`${providerName}: tool-call network failure, trying next model`, {
        model,
        reason: msg.slice(0, 160),
      });
      lastError = msg;
      continue;
    }

    if (response.ok) {
      try {
        const data = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                id?: string;
                function?: { name?: string; arguments?: unknown };
              }>;
            };
            finish_reason?: string;
          }>;
        };
        const choice = data?.choices?.[0];
        const rawToolCalls = choice?.message?.tool_calls;
        const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
        const toolCalls: ProviderToolCall[] = Array.isArray(rawToolCalls)
          ? rawToolCalls
              .filter(
                (tc): tc is { id: string; function: { name: string; arguments: unknown } } =>
                  !!tc &&
                  typeof tc.id === 'string' &&
                  !!tc.function &&
                  typeof tc.function.name === 'string'
              )
              .map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.function.name,
                  arguments:
                    typeof tc.function.arguments === 'string'
                      ? tc.function.arguments
                      : JSON.stringify(tc.function.arguments ?? {}),
                },
              }))
          : [];

        return {
          content,
          toolCalls,
          hasToolCalls: toolCalls.length > 0,
          model,
          finishReason: choice?.finish_reason,
        };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        throw new Error(`${providerName} API error: failed to parse tool-call response: ${msg}`);
      }
    }

    const status = response.status;
    const body = await response.text().catch(() => '');
    const isRateLimit = status === 429;
    const isServerError = status >= 500 && status <= 599;
    if (!(isRateLimit || isServerError)) {
      throw new Error(`${providerName} API error: ${status} - ${body.slice(0, 400)}`);
    }
    logger.warn(`${providerName}: tool-call model fallback`, {
      model,
      status,
      reason: isRateLimit ? 'rate-limit' : 'server-error',
    });
    lastError = body;
  }

  throw new Error(
    `${providerName} API error: all tool-capable models exhausted. Last error: ${lastError.slice(0, 400)}`
  );
}

// ============================================
// ZAI Provider
// ============================================

export class ZAIProvider implements AIProvider {
  name = 'zai';
  models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];

  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'glm-5',
    'glm-4.7',
  ]);

  private apiKey: string;
  private baseUrl = 'https://api.zukijourney.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ZAI_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('ZAI_API_KEY not set');
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'glm-5',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    }, PROVIDER_TIMEOUT_MS, options?.signal);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
    return openAICompatibleChatWithTools({
      providerName: 'zai',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      messages,
      options,
      toolCapableModels: this.toolCapableModels,
      defaultModel: 'glm-5',
    });
  }
}

// ============================================
// OpenAI Provider
// ============================================

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  models = ['gpt-5.2', 'gpt-5.1', 'gpt-4o'];

  supportsToolCalls = true;
  // All current OpenAI chat-completion models support the `tools` parameter.
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'gpt-5.2',
    'gpt-5.1',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
  ]);

  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-5.2',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    }, PROVIDER_TIMEOUT_MS, options?.signal);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
    return openAICompatibleChatWithTools({
      providerName: 'openai',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      messages,
      options,
      toolCapableModels: this.toolCapableModels,
      defaultModel: 'gpt-4o-mini',
    });
  }
}

// ============================================
// AIJora Provider (Российский агрегатор)
// ============================================

export class AIJoraProvider implements AIProvider {
  name = 'aijora';
  models = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-3.5-turbo',
    'claude-3-5-sonnet',
    'claude-3-haiku',
  ];

  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'gpt-4o-mini',
    'gpt-4o',
    'claude-3-5-sonnet',
  ]);

  private apiKey: string;
  private baseUrl = 'https://api.aijora.com/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.AIJORA_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('AIJORA_API_KEY not set');
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AIJora API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
    return openAICompatibleChatWithTools({
      providerName: 'aijora',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      messages,
      options,
      toolCapableModels: this.toolCapableModels,
      defaultModel: 'gpt-4o-mini',
    });
  }
}

// ============================================
// Polza.ai Provider (Российский агрегатор)
// ============================================

export class PolzaProvider implements AIProvider {
  name = 'polza';
  models = [
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3-haiku',
    'deepseek/deepseek-r1',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-coder',
    'google/gemini-2.0-flash',
  ];

  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'anthropic/claude-3.5-sonnet',
  ]);

  private apiKey: string;
  private baseUrl = 'https://polza.ai/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.POLZA_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('POLZA_API_KEY not set');
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'openai/gpt-4o-mini',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Polza.ai API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
    return openAICompatibleChatWithTools({
      providerName: 'polza',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      messages,
      options,
      toolCapableModels: this.toolCapableModels,
      defaultModel: 'openai/gpt-4o-mini',
    });
  }
}

// ============================================
// Bothub Provider (Российский агрегатор)
// ============================================

export class BothubProvider implements AIProvider {
  name = 'bothub';
  models = [
    'gpt-4o-mini',
    'gpt-4o',
    'claude-3.5-sonnet',
    'deepseek-r1',
    'qwen-2.5-coder',
    'yandexgpt',
  ];

  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'gpt-4o-mini',
    'gpt-4o',
    'claude-3.5-sonnet',
  ]);

  private apiKey: string;
  private baseUrl = 'https://bothub.chat/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BOTHUB_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('BOTHUB_API_KEY not set');
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bothub API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
    return openAICompatibleChatWithTools({
      providerName: 'bothub',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      messages,
      options,
      toolCapableModels: this.toolCapableModels,
      defaultModel: 'gpt-4o-mini',
    });
  }
}

// ============================================
// GigaChat Provider (Сбер, бесплатный 32K контекст)
// ============================================

export class GigaChatProvider implements AIProvider {
  name = 'gigachat';
  models = ['GigaChat', 'GigaChat-Plus', 'GigaChat-Pro', 'GigaChat-Max', 'GigaChat-2'];

  /**
   * Models with native function/tool calling. Sber's `functions` API is
   * compatible with the pre-`tools` OpenAI format; we map it to our
   * ChatWithToolsResult in `chatWithTools`.
   */
  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'GigaChat-Pro',
    'GigaChat-Max',
    'GigaChat-2',
  ]);

  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(clientId?: string, clientSecret?: string) {
    this.clientId = clientId || process.env.GIGACHAT_CLIENT_ID || '';
    this.clientSecret = clientSecret || process.env.GIGACHAT_CLIENT_SECRET || '';
  }

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = this.refreshToken().finally(() => {
        this.tokenRefreshPromise = null;
      });
    }

    return this.tokenRefreshPromise;
  }

  private async refreshToken(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const rquid = crypto.randomUUID?.() || Math.random().toString(36).slice(2);

    const token = await new Promise<string>((resolve, reject) => {
      const body = Buffer.from('scope=GIGACHAT_API_PERS');
      const req = https.request({
        hostname: 'ngw.devices.sberbank.ru',
        port: 9443,
        path: '/api/v2/oauth',
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'RqUID': rquid,
          'Content-Length': body.length,
        },
        rejectUnauthorized: false,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data.access_token);
          } catch (e) { reject(e); }
        });
      });
      req.setTimeout(PROVIDER_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timeout after ${PROVIDER_TIMEOUT_MS}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    this.accessToken = token;
    this.tokenExpiresAt = Date.now() + 25 * 60 * 1000; // 25 min (token valid 30min)
    return token;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET not set');
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const token = await this.getToken();
    const model = options?.model || this.models[0];

    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      }));
      const req = https.request({
        hostname: 'gigachat.devices.sberbank.ru',
        port: 443,
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        rejectUnauthorized: false,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (res.statusCode && res.statusCode >= 400) {
              throw new Error(`GigaChat error ${res.statusCode}: ${JSON.stringify(data)}`);
            }
            resolve(data.choices[0].message.content);
          } catch (e) { reject(e); }
        });
      });
      req.setTimeout(PROVIDER_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timeout after ${PROVIDER_TIMEOUT_MS}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Native tool calling via Sber's `functions` API. Response shape matches
   * the legacy OpenAI `function_call` format: the assistant message has a
   * `function_call: { name, arguments }` field when the model decided to
   * invoke a tool. We normalise it into a single-element `toolCalls` array
   * for parity with OpenAI-compatible providers.
   *
   * Runtime note: Sber endpoints use a Russian Trusted Root CA that isn't
   * in Node's default trust store. To keep this method testable via
   * `fetch`/`undici`, we rely on the standard runtime. Deployments must
   * either (a) set `NODE_EXTRA_CA_CERTS=/path/to/russian_trusted_root.pem`,
   * or (b) route GigaChat through a trusted proxy. The legacy `chat()`
   * method above uses `rejectUnauthorized: false` for convenience; once
   * the CA is installed we can migrate it to `fetch` as well.
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResult> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET not set');
    }

    const token = await this.getToken();
    const requested = options.model ?? 'GigaChat-Pro';
    const primary = this.toolCapableModels.has(requested) ? requested : 'GigaChat-Pro';
    const fallback = Array.from(this.toolCapableModels).filter((m) => m !== primary);
    const chain = [primary, ...fallback];

    // Map OpenAI `tools: [{type:'function', function:{...}}]` → GigaChat `functions: [{...}]`.
    const functions = options.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));

    // GigaChat accepts `function_call: 'auto' | 'none' | { name }`. Map OpenAI's
    // `tool_choice` onto that; 'required' has no direct analogue, so we fall
    // back to 'auto' and rely on prompt-level nudging.
    const functionCall: 'auto' | 'none' =
      options.toolChoice === 'none' ? 'none' : 'auto';

    let lastError = '';
    for (const model of chain) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: options.temperature ?? 0.7,
              max_tokens: options.maxTokens ?? 4096,
              functions,
              function_call: functionCall,
            }),
          }
        );
      } catch (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        logger.warn('gigachat: tool-call network failure, trying next model', {
          model,
          reason: msg.slice(0, 160),
        });
        lastError = msg;
        continue;
      }

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              function_call?: { name?: string; arguments?: unknown };
            };
            finish_reason?: string;
          }>;
        };
        const choice = data?.choices?.[0];
        const fc = choice?.message?.function_call;
        const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
        const toolCalls: ProviderToolCall[] = fc && typeof fc.name === 'string'
          ? [
              {
                id: `gigachat_fc_${Date.now()}`,
                type: 'function' as const,
                function: {
                  name: fc.name,
                  arguments:
                    typeof fc.arguments === 'string'
                      ? fc.arguments
                      : JSON.stringify(fc.arguments ?? {}),
                },
              },
            ]
          : [];
        return {
          content,
          toolCalls,
          hasToolCalls: toolCalls.length > 0,
          model,
          finishReason: choice?.finish_reason,
        };
      }

      const status = response.status;
      const body = await response.text().catch(() => '');
      const isRateLimit = status === 429;
      const isServerError = status >= 500 && status <= 599;
      if (!(isRateLimit || isServerError)) {
        throw new Error(`gigachat API error: ${status} - ${body.slice(0, 400)}`);
      }
      logger.warn('gigachat: tool-call model fallback', {
        model,
        status,
        reason: isRateLimit ? 'rate-limit' : 'server-error',
      });
      lastError = body;
    }

    throw new Error(
      `gigachat API error: all tool-capable models exhausted. Last error: ${lastError.slice(0, 400)}`
    );
  }
}

// ============================================
// YandexGPT Provider
// ============================================

export class YandexGPTProvider implements AIProvider {
  name = 'yandexgpt';
  models = ['yandexgpt-lite', 'yandexgpt', 'yandexgpt-32k'];

  /**
   * Yandex Foundation Models supports function calling on the flagship
   * `yandexgpt` model. The response shape differs from OpenAI (see
   * `chatWithTools`), so we normalise it to `ChatWithToolsResult`.
   */
  supportsToolCalls = true;
  private readonly toolCapableModels: ReadonlySet<string> = new Set([
    'yandexgpt',
    'yandexgpt-32k',
  ]);

  private apiKey: string;
  private folderId: string;

  constructor(apiKey?: string, folderId?: string) {
    this.apiKey = apiKey || process.env.YANDEXGPT_API_KEY || '';
    this.folderId = folderId || process.env.YANDEX_FOLDER_ID || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey || !this.folderId) {
      throw new Error('YANDEXGPT_API_KEY / YANDEX_FOLDER_ID not set');
    }

    const modelId = options?.model || this.models[0];
    const modelUri = `gpt://${this.folderId}/${modelId}`;

    // YandexGPT uses `text` instead of `content`
    const yandexMessages = messages.map(m => ({ role: m.role, text: m.content }));

    const response = await fetchWithTimeout('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelUri,
        completionOptions: {
          stream: false,
          temperature: options?.temperature ?? 0.6,
          maxTokens: String(options?.maxTokens ?? 4096),
        },
        messages: yandexMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`YandexGPT error ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data.result.alternatives[0].message.text;
  }

  /**
   * Native function calling for YandexGPT 5+. The Yandex API uses `text`
   * instead of OpenAI's `content`, and returns tool calls via
   * `message.toolCallList.toolCalls[].functionCall` where `arguments`
   * is an object (not a string). We normalise everything into
   * `ChatWithToolsResult` for parity with OpenAI-compatible providers.
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResult> {
    if (!this.apiKey || !this.folderId) {
      throw new Error('YANDEXGPT_API_KEY / YANDEX_FOLDER_ID not set');
    }

    const requested = options.model ?? 'yandexgpt';
    const primary = this.toolCapableModels.has(requested) ? requested : 'yandexgpt';
    const fallback = Array.from(this.toolCapableModels).filter((m) => m !== primary);
    const chain = [primary, ...fallback];

    const yandexMessages = messages.map((m) => ({ role: m.role, text: m.content }));
    const tools = options.tools.map((t) => ({
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));

    let lastError = '';
    for (const model of chain) {
      const modelUri = `gpt://${this.folderId}/${model}`;
      let response: Response;
      try {
        response = await fetchWithTimeout(
          'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
          {
            method: 'POST',
            headers: {
              Authorization: `Api-Key ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              modelUri,
              completionOptions: {
                stream: false,
                temperature: options.temperature ?? 0.6,
                maxTokens: String(options.maxTokens ?? 4096),
              },
              messages: yandexMessages,
              tools,
            }),
          }
        );
      } catch (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        logger.warn('yandexgpt: tool-call network failure, trying next model', {
          model,
          reason: msg.slice(0, 160),
        });
        lastError = msg;
        continue;
      }

      if (response.ok) {
        const data = (await response.json()) as {
          result?: {
            alternatives?: Array<{
              message?: {
                role?: string;
                text?: string | null;
                toolCallList?: {
                  toolCalls?: Array<{
                    functionCall?: { name?: string; arguments?: unknown };
                  }>;
                };
              };
              status?: string;
            }>;
          };
        };
        const alt = data?.result?.alternatives?.[0];
        const rawCalls = alt?.message?.toolCallList?.toolCalls;
        const content = typeof alt?.message?.text === 'string' ? alt.message.text : '';
        const toolCalls: ProviderToolCall[] = Array.isArray(rawCalls)
          ? rawCalls
              .filter(
                (tc): tc is { functionCall: { name: string; arguments: unknown } } =>
                  !!tc &&
                  !!tc.functionCall &&
                  typeof tc.functionCall.name === 'string'
              )
              .map((tc, index) => ({
                id: `yandex_fc_${Date.now()}_${index}`,
                type: 'function' as const,
                function: {
                  name: tc.functionCall.name,
                  arguments:
                    typeof tc.functionCall.arguments === 'string'
                      ? tc.functionCall.arguments
                      : JSON.stringify(tc.functionCall.arguments ?? {}),
                },
              }))
          : [];

        return {
          content,
          toolCalls,
          hasToolCalls: toolCalls.length > 0,
          model,
          finishReason: alt?.status,
        };
      }

      const status = response.status;
      const body = await response.text().catch(() => '');
      const isRateLimit = status === 429;
      const isServerError = status >= 500 && status <= 599;
      if (!(isRateLimit || isServerError)) {
        throw new Error(`yandexgpt API error: ${status} - ${body.slice(0, 400)}`);
      }
      logger.warn('yandexgpt: tool-call model fallback', {
        model,
        status,
        reason: isRateLimit ? 'rate-limit' : 'server-error',
      });
      lastError = body;
    }

    throw new Error(
      `yandexgpt API error: all tool-capable models exhausted. Last error: ${lastError.slice(0, 400)}`
    );
  }
}

function getConfiguredProviderPriority(): string[] {
  return ['gigachat', 'yandexgpt', 'aijora', 'polza', 'openrouter', 'bothub', 'zai', 'openai'];
}

// ============================================
// AI Router
// ============================================

export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider = 'openrouter';
  private providerPriority: string[] = getConfiguredProviderPriority();

  constructor() {
    // Initialize providers from env (in priority order)
    if (process.env.GIGACHAT_CLIENT_ID && process.env.GIGACHAT_CLIENT_SECRET) {
      this.providers.set('gigachat', new GigaChatProvider());
    }

    if (process.env.YANDEXGPT_API_KEY && process.env.YANDEX_FOLDER_ID) {
      this.providers.set('yandexgpt', new YandexGPTProvider());
    }

    if (process.env.AIJORA_API_KEY) {
      this.providers.set('aijora', new AIJoraProvider());
    }

    if (process.env.POLZA_API_KEY) {
      this.providers.set('polza', new PolzaProvider());
    }

    if (process.env.OPENROUTER_API_KEY) {
      this.providers.set('openrouter', new OpenRouterProvider());
    }

    if (process.env.BOTHUB_API_KEY) {
      this.providers.set('bothub', new BothubProvider());
    }

    if (process.env.ZAI_API_KEY) {
      this.providers.set('zai', new ZAIProvider());
    }

    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider());
    }

    for (const manifest of loadConfiguredAIProviderManifests()) {
      if (this.providers.has(manifest.name)) {
        logger.warn("Skipping duplicate configured AI provider", {
          provider: manifest.name,
        });
        continue;
      }

      this.providers.set(manifest.name, createConfiguredAIProvider(manifest));
      this.providerPriority.push(manifest.name);
    }

    // Set default provider (highest priority available)
    if (process.env.DEFAULT_AI_PROVIDER) {
      this.defaultProvider = process.env.DEFAULT_AI_PROVIDER;
    } else {
      // Use first available from priority list
      for (const provider of this.providerPriority) {
        if (this.providers.has(provider)) {
          this.defaultProvider = provider;
          break;
        }
      }
    }
  }

  /**
   * Chat with AI — with circuit breaker protection and cross-provider fallback.
   *
   * If the requested provider's circuit is open or the call fails, automatically
   * tries the next provider in priority order. Tracks cost for every successful call.
   */
  async chat(
    messages: Message[],
    options: { provider?: string; model?: string; agentId?: string; runId?: string; workspaceId?: string; signal?: AbortSignal } = {}
  ): Promise<string> {
    const requested = options.provider || this.defaultProvider;
    if (options.workspaceId) {
      const withinBudget = await checkCostBudget(options.workspaceId);
      if (!withinBudget) {
        throw new Error(`AI daily cost limit reached for workspace ${options.workspaceId}`);
      }
    }
    const fallbackChain = this.buildFallbackChain(requested);

    let lastError: Error = new Error("No AI providers available");

    for (const providerName of fallbackChain) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      const cb = getCircuitBreaker(`ai:${providerName}`);
      const recordCost = buildCostRecorder(
        providerName,
        options.model || provider.models[0],
        messages,
        { agentId: options.agentId, runId: options.runId, workspaceId: options.workspaceId }
      );

      try {
        const result = await cb.execute(() => provider.chat(messages, options), {
          timeoutMs: CIRCUIT_TIMEOUT_MS,
        });
        recordCost(result);
        if (providerName !== requested) {
          logger.info("ai-router: fallback provider used", { requested, used: providerName });
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof CircuitOpenError) {
          logger.warn("ai-router: circuit open, trying next provider", { provider: providerName });
          continue;
        }
        if (isTransientProviderError(lastError)) {
          logger.warn("ai-router: provider error, trying fallback", {
            provider: providerName,
            error: lastError.message.slice(0, 160),
          });
          continue;
        }
        // Non-retryable error (e.g., bad request content) — throw immediately
        throw lastError;
      }
    }

    throw lastError;
  }

  /**
   * Tool-aware chat — routes to the first provider that supports native
   * function calling (`provider.chatWithTools`) with circuit breaker and
   * cross-provider fallback. If no tool-capable provider is available (or
   * they all fail transiently), degrades gracefully by calling `.chat()` on
   * the regular provider chain and returning content with `toolCalls: []`
   * so the caller can fall back to text-level JSON parsing.
   */
  async chatWithTools(
    messages: Message[],
    options: {
      provider?: string;
      model?: string;
      agentId?: string;
      runId?: string;
      workspaceId?: string;
      temperature?: number;
      maxTokens?: number;
      tools: readonly ProviderToolDefinition[];
      toolChoice?: "auto" | "required" | "none";
    }
  ): Promise<ChatWithToolsResult> {
    if (options.workspaceId) {
      const withinBudget = await checkCostBudget(options.workspaceId);
      if (!withinBudget) {
        throw new Error(`AI daily cost limit reached for workspace ${options.workspaceId}`);
      }
    }

    const requested = options.provider || this.defaultProvider;
    const fallbackChain = this.buildToolFallbackChain(requested);

    let lastError: Error = new Error("No AI providers available");
    for (const providerName of fallbackChain) {
      const provider = this.providers.get(providerName);
      if (!provider?.chatWithTools) continue;

      const cb = getCircuitBreaker(`ai:${providerName}`);
      const recordCost = buildCostRecorder(
        providerName,
        options.model || provider.models[0],
        messages,
        { agentId: options.agentId, runId: options.runId, workspaceId: options.workspaceId }
      );

      try {
        const result = await cb.execute(
          () =>
            provider.chatWithTools!(messages, {
              model: options.model,
              temperature: options.temperature,
              maxTokens: options.maxTokens,
              tools: options.tools,
              toolChoice: options.toolChoice ?? "auto",
            }),
          { timeoutMs: CIRCUIT_TIMEOUT_MS }
        );

        // Approximate cost using content + serialised tool calls to keep
        // budget accounting honest even when the model only emits calls.
        const costingSample = `${result.content}\n${JSON.stringify(result.toolCalls)}`;
        recordCost(costingSample);

        if (providerName !== requested) {
          logger.info("ai-router: fallback tool-capable provider used", {
            requested,
            used: providerName,
          });
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof CircuitOpenError) {
          logger.warn("ai-router: tool-call circuit open, trying next", { provider: providerName });
          continue;
        }
        if (isTransientProviderError(lastError)) {
          logger.warn("ai-router: tool-call provider error, trying fallback", {
            provider: providerName,
            error: lastError.message.slice(0, 160),
          });
          continue;
        }
        throw lastError;
      }
    }

    // No tool-capable provider succeeded — degrade to text chat so the caller
    // can still make progress via legacy JSON parsing. Signal this via
    // `toolCalls: []` and a marker in finishReason so upstream can decide.
    logger.warn("ai-router: no tool-capable provider succeeded, degrading to text chat", {
      reason: lastError.message.slice(0, 160),
    });
    const fallbackContent = await this.chat(messages, {
      provider: options.provider,
      model: options.model,
      agentId: options.agentId,
      runId: options.runId,
      workspaceId: options.workspaceId,
    });
    return {
      content: fallbackContent,
      toolCalls: [],
      hasToolCalls: false,
      model: options.model ?? "unknown",
      finishReason: "text_fallback",
    };
  }

  /** Does any registered provider advertise native tool-call support? */
  hasToolCapableProvider(): boolean {
    for (const p of this.providers.values()) {
      if (p.supportsToolCalls && p.chatWithTools) return true;
    }
    return false;
  }

  /**
   * Build ordered fallback chain starting from the requested provider,
   * followed by all remaining providers in priority order.
   */
  private buildFallbackChain(preferred: string): string[] {
    const chain: string[] = [];
    if (this.providers.has(preferred)) chain.push(preferred);
    for (const p of this.providerPriority) {
      if (p !== preferred && this.providers.has(p)) chain.push(p);
    }
    return chain;
  }

  /**
   * Like buildFallbackChain but filtered to providers that expose
   * chatWithTools / supportsToolCalls. The requested provider is kept first
   * if capable; otherwise skipped.
   */
  private buildToolFallbackChain(preferred: string): string[] {
    const capable = (name: string) => {
      const p = this.providers.get(name);
      return !!(p && p.supportsToolCalls && p.chatWithTools);
    };
    const chain: string[] = [];
    if (capable(preferred)) chain.push(preferred);
    for (const p of this.providerPriority) {
      if (p !== preferred && capable(p)) chain.push(p);
    }
    return chain;
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get available models
   */
  getAvailableModels(): { provider: string; model: string }[] {
    const models: { provider: string; model: string }[] = [];

    for (const [name, provider] of this.providers) {
      for (const model of provider.models) {
        models.push({ provider: name, model });
      }
    }

    return models;
  }

  /**
   * Get provider instance (for streaming or direct access)
   */
  getProviderInstance(providerName?: string): AIProvider {
    const name = providerName || this.defaultProvider;
    const provider = this.providers.get(name);
    if (!provider) {
      // Fallback to any available provider
      const first = this.providers.values().next().value;
      if (first) return first;
      throw new Error(`Provider ${name} not available. Check API keys in .env`);
    }
    return provider;
  }

  /**
   * Get first provider that supports streaming (chatStream method)
   * Priority: openrouter > aijora > polza > any
   */
  getStreamingProvider(preferredName?: string): AIProvider | null {
    // Try the requested provider first
    if (preferredName) {
      const p = this.providers.get(preferredName);
      if (p?.chatStream) return p;
    }
    // Prefer openrouter (has streaming implementation)
    for (const name of ['openrouter', ...this.providerPriority]) {
      const p = this.providers.get(name);
      if (p?.chatStream) return p;
    }
    return null;
  }

  /**
   * Check if provider is available
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }
}

// ============================================
// Helper Functions for Health Check
// ============================================

let _routerInstance: AIRouter | null = null;

export function getRouter(): AIRouter {
  if (!_routerInstance) {
    _routerInstance = new AIRouter();
  }
  return _routerInstance;
}

/**
 * Check if any AI provider is available
 */
export async function hasAvailableProvider(): Promise<boolean> {
  try {
    const router = getRouter();
    const providers = router.getAvailableProviders();
    return providers.length > 0;
  } catch (error) {
    logger.error("Error checking providers", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Get the default provider name
 */
export function getProviderName(): string | null {
  try {
    const router = getRouter();
    const providers = router.getAvailableProviders();
    
    if (providers.length === 0) return null;
    
    // Return default provider if set
    if (process.env.DEFAULT_AI_PROVIDER && providers.includes(process.env.DEFAULT_AI_PROVIDER)) {
      return process.env.DEFAULT_AI_PROVIDER;
    }
    
    // Otherwise return first available
    return providers[0];
  } catch (error) {
    logger.error("Error getting provider name", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

// Export singleton instance
export const aiRouter = getRouter();
