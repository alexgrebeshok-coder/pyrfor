import type { AIProvider, Message, ChatOptions } from "./base";
import { logger } from '../../observability/logger';

// DNS cache (5 min TTL)
const _dnsCache = new Map<string, { ip: string; expiresAt: number }>();
const DNS_TTL_MS = 5 * 60 * 1000;

function getCachedIPv4(hostname: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dns = require('dns') as typeof import('dns');
  const cached = _dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.ip);
  return new Promise((resolve) => {
    dns.resolve4(hostname, (err, addresses) => {
      _dnsCache.set(hostname, { ip: addresses[0], expiresAt: Date.now() + DNS_TTL_MS });
      resolve(addresses[0]);
    });
  });
}

export { getCachedIPv4 };
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

  private async httpsPost(payload: string, signal?: AbortSignal): Promise<string> {
    // Use Node.js https module to avoid undici/IPv6 DNS issues in Next.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    const host = await getCachedIPv4('openrouter.ai');
    return new Promise((resolve, reject) => {
      const body = Buffer.from(payload);
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
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(JSON.stringify({ status: res.statusCode, body: data })));
      });
      req.on('error', reject);
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
      }), options?.signal);

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
        for await (const chunk of this._streamModel(messages, model, options?.signal)) {
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
  private async *_streamModel(messages: Message[], model: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
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
    let wake: (() => void) | null = null;
    const notify = () => { const cb = wake; wake = null; cb?.(); };

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
            if (content) { queue.push(content); notify(); }
          } catch { /* skip malformed SSE line */ }
        }
      });
      res.on('end', () => { streamDone = true; notify(); });
      res.on('error', (err: Error) => { streamError = err; streamDone = true; notify(); });
    });
    req.on('error', (err: Error) => { streamError = err; streamDone = true; notify(); });
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('Request aborted'));
        throw new Error('Request aborted');
      }
      signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted'));
      }, { once: true });
    }
    req.write(body);
    req.end();

    while (!streamDone || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (!streamDone) {
        await new Promise<void>(r => { wake = r; });
      }
      if (streamError) throw streamError;
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
