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
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
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
}

export interface AIProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}

// ============================================
// OpenRouter Provider
// ============================================

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models = [
    'google/gemma-3-27b-it:free',
    'google/gemma-3-12b-it:free',
    'google/gemma-3-4b-it:free',
    'openai/gpt-4o-mini',
  ];

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  private async httpsPost(payload: string): Promise<string> {
    // Use Node.js https module to avoid undici/IPv6 DNS issues in Next.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const host = await getCachedIPv4('openrouter.ai');
    return new Promise((resolve, reject) => {
      const body = Buffer.from(payload);
      let resRef: import('http').IncomingMessage | null = null;
      const req = https.request({
        hostname: host,
        port: 443,
        path: '/api/v1/chat/completions',
        method: 'POST',
        servername: 'openrouter.ai', // required for TLS SNI when using IP
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://ceoclaw.com',
          'X-Title': 'CEOClaw',
          'Host': 'openrouter.ai',
          'Content-Length': body.length,
        },
      }, (res) => {
        resRef = res;
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(JSON.stringify({ status: res.statusCode, body: data })));
      });
      req.setTimeout(PROVIDER_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timeout after ${PROVIDER_TIMEOUT_MS}ms`));
      });
      req.on('error', reject);
      req.on('close', () => {
        resRef?.removeAllListeners();
        req.removeAllListeners();
      });
      req.write(body);
      req.end();
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    const requestedModel = options?.model || this.models[0];
    const fallbackChain = [requestedModel, ...this.models.filter(m => m !== requestedModel)];
    let lastError = '';

    for (const model of fallbackChain) {
      // Gemma models don't support system messages — merge into user message
      const preparedMessages = model.includes('gemma')
        ? this.mergeSystemIntoUser(messages)
        : messages;

      const rawResp = await this.httpsPost(JSON.stringify({
        model,
        messages: preparedMessages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }));

      const { status, body } = JSON.parse(rawResp);

      if (status >= 200 && status < 300) {
        const data = JSON.parse(body);
        return data.choices[0].message.content;
      }

      // Fall through on rate-limit or "developer instruction" errors (Gemma limitation)
      const shouldRetry = status === 429 || (status === 400 && body.includes('Developer instruction'));
      if (!shouldRetry) {
        throw new Error(`OpenRouter API error: ${status} - ${body}`);
      }
      logger.warn('OpenRouter model fallback', { model, status, reason: shouldRetry ? 'retry' : 'error' });
      lastError = body;
    }

    throw new Error(`OpenRouter: all models exhausted. Last error: ${lastError}`);
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
// ZAI Provider
// ============================================

export class ZAIProvider implements AIProvider {
  name = 'zai';
  models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];

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
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

// ============================================
// OpenAI Provider
// ============================================

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  models = ['gpt-5.2', 'gpt-5.1', 'gpt-4o'];

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
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
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
}

// ============================================
// GigaChat Provider (Сбер, бесплатный 32K контекст)
// ============================================

export class GigaChatProvider implements AIProvider {
  name = 'gigachat';
  models = ['GigaChat', 'GigaChat-Plus', 'GigaChat-Pro'];

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
}

// ============================================
// YandexGPT Provider
// ============================================

export class YandexGPTProvider implements AIProvider {
  name = 'yandexgpt';
  models = ['yandexgpt-lite', 'yandexgpt', 'yandexgpt-32k'];

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
    options: { provider?: string; model?: string; agentId?: string; runId?: string; workspaceId?: string } = {}
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
        // For non-circuit errors, only fall back if provider-level failure
        const isProviderError =
          lastError.message.includes("API error") ||
          lastError.message.includes("not set") ||
          lastError.message.includes("not available");
        if (isProviderError) {
          logger.warn("ai-router: provider error, trying fallback", {
            provider: providerName,
            error: lastError.message.slice(0, 120),
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
