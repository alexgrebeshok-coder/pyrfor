/**
 * provider-service.test.ts — Unit tests for ProviderService.
 *
 * All tests use a fake RouterLike; no real providers or network I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProviderService,
  classifyError,
  normalizeMessages,
  estimateUsage,
  type ChatRequest,
  type ChatMessage,
  type RouterLike,
} from './provider-service';
import type { LlmResponse, ProviderStatus } from '../runtime/llm-provider-router';

// ====== Test helpers ======================================================

function makeResponse(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return {
    provider: 'test-provider',
    text: 'Hello, world!',
    latencyMs: 50,
    usage: { promptTokens: 10, completionTokens: 5 },
    ...overrides,
  };
}

function makeRouter(overrides: Partial<RouterLike> = {}): RouterLike {
  const defaultStatus: ProviderStatus = {
    id: 'test-provider',
    healthy: true,
    successRate: 1,
    avgLatencyMs: 50,
    activeCalls: 0,
  };
  return {
    call: vi.fn<Parameters<RouterLike['call']>, ReturnType<RouterLike['call']>>()
      .mockResolvedValue(makeResponse()),
    listProviders: vi.fn<[], ProviderStatus[]>().mockReturnValue([defaultStatus]),
    ...overrides,
  };
}

const baseReq: ChatRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
};

// ====== ProviderService — chat() =========================================

describe('ProviderService.chat()', () => {
  it('returns ChatResponse with normalized fields and latencyMs > 0', async () => {
    const router = makeRouter();
    const service = new ProviderService({ router });

    const result = await service.chat(baseReq);

    expect(result.content).toBe('Hello, world!');
    expect(result.provider).toBe('test-provider');
    expect(result.finishReason).toBe('stop');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('uses req.modelProfile when provided', async () => {
    const router = makeRouter();
    const service = new ProviderService({ router, defaultModelProfile: 'balanced' });

    const result = await service.chat({ ...baseReq, modelProfile: 'reasoning' });

    expect(result.model).toBe('reasoning');
  });

  it('falls back to defaultModelProfile when req.modelProfile is absent', async () => {
    const router = makeRouter();
    const service = new ProviderService({ router, defaultModelProfile: 'fast' });

    const result = await service.chat(baseReq);

    expect(result.model).toBe('fast');
  });

  it('passes providerHint as router order', async () => {
    const router = makeRouter();
    const service = new ProviderService({ router });

    await service.chat({ ...baseReq, providerHint: 'openai' });

    expect(router.call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ order: ['openai'] }),
    );
  });

  it('sets finishReason="tool_calls" when router returns toolCalls', async () => {
    const router = makeRouter({
      call: vi.fn().mockResolvedValue(
        makeResponse({
          toolCalls: [{ id: 'c1', name: 'search', arguments: { q: 'vitest' } }],
        }),
      ),
    });
    const service = new ProviderService({ router });

    const result = await service.chat(baseReq);

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('search');
  });

  it('uses estimateUsage as fallback when router returns no usage', async () => {
    const router = makeRouter({
      call: vi.fn().mockResolvedValue(makeResponse({ usage: undefined })),
    });
    const service = new ProviderService({ router });

    const result = await service.chat(baseReq);

    expect(result.usage?.promptTokens).toBeGreaterThan(0);
    expect(result.usage?.completionTokens).toBeGreaterThan(0);
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
  });

  // ── Timeout ─────────────────────────────────────────────────────────────

  it('throws AbortError when router never resolves and timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const router = makeRouter({
        call: vi.fn(() => new Promise<LlmResponse>(() => { /* never resolves */ })),
      });
      const service = new ProviderService({ router, defaultTimeoutMs: 100 });

      const chatPromise = service.chat(baseReq);
      vi.runAllTimers();

      await expect(chatPromise).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      vi.useRealTimers();
    }
  });

  // ── AbortSignal pre-aborted ──────────────────────────────────────────────

  it('rejects immediately when AbortSignal is already aborted; router not called', async () => {
    const router = makeRouter();
    const service = new ProviderService({ router });

    const controller = new AbortController();
    controller.abort();

    await expect(
      service.chat({ ...baseReq, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(router.call).not.toHaveBeenCalled();
  });

  // ── Retry logic ─────────────────────────────────────────────────────────

  it('retries on transient error and succeeds on 2nd attempt', async () => {
    let callCount = 0;
    const router = makeRouter({
      call: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('ECONNRESET'));
        return Promise.resolve(makeResponse({ text: 'retry success' }));
      }),
    });
    const service = new ProviderService({
      router,
      retry: { attempts: 2, backoffMs: 0 },
    });

    const result = await service.chat(baseReq);

    expect(result.content).toBe('retry success');
    expect(router.call).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retry attempts on persistent transient error', async () => {
    const transientError = new Error('fetch failed');
    const router = makeRouter({
      call: vi.fn().mockRejectedValue(transientError),
    });
    const service = new ProviderService({
      router,
      retry: { attempts: 3, backoffMs: 0 },
    });

    await expect(service.chat(baseReq)).rejects.toBe(transientError);
    expect(router.call).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on a permanent error', async () => {
    const permanentError = new Error('400 bad_request: invalid_api_key');
    const router = makeRouter({
      call: vi.fn().mockRejectedValue(permanentError),
    });
    const service = new ProviderService({
      router,
      retry: { attempts: 3, backoffMs: 0 },
    });

    await expect(service.chat(baseReq)).rejects.toBe(permanentError);
    expect(router.call).toHaveBeenCalledTimes(1);
  });
});

// ====== ProviderService — listProviders() ================================

describe('ProviderService.listProviders()', () => {
  it('maps router ProviderStatus to {name, available}', () => {
    const router = makeRouter({
      listProviders: vi.fn().mockReturnValue([
        { id: 'openai', healthy: true, successRate: 1, avgLatencyMs: 100, activeCalls: 0 },
        { id: 'backup', healthy: false, successRate: 0.2, avgLatencyMs: 500, activeCalls: 0 },
      ]),
    });
    const service = new ProviderService({ router });

    const providers = service.listProviders();

    expect(providers).toEqual([
      { name: 'openai', available: true },
      { name: 'backup', available: false },
    ]);
  });

  it('returns [] when router does not expose listProviders', () => {
    const router: RouterLike = { call: vi.fn().mockResolvedValue(makeResponse()) };
    const service = new ProviderService({ router });

    expect(service.listProviders()).toEqual([]);
  });
});

// ====== ProviderService — onError() ======================================

describe('ProviderService.onError()', () => {
  it('invokes listener when an error occurs and returns an unsubscribe fn', async () => {
    const permanentError = new Error('401 unauthorized');
    const router = makeRouter({ call: vi.fn().mockRejectedValue(permanentError) });
    const service = new ProviderService({ router });

    const errors: Error[] = [];
    const off = service.onError(e => errors.push(e));

    await expect(service.chat(baseReq)).rejects.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(permanentError);

    // Unsubscribe and verify no further events.
    off();
    await expect(service.chat(baseReq)).rejects.toThrow();
    expect(errors).toHaveLength(1);
  });
});

// ====== estimateUsage ====================================================

describe('estimateUsage()', () => {
  it('returns counts > 0 for non-empty request and content', () => {
    const req: ChatRequest = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    };
    const usage = estimateUsage(req, 'The capital of France is Paris.');

    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
  });

  it('uses 4-chars-per-token heuristic', () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: '1234' }] }; // 4 chars → 1 token
    const usage = estimateUsage(req, '12345678'); // 8 chars → 2 tokens

    expect(usage.promptTokens).toBe(1);
    expect(usage.completionTokens).toBe(2);
    expect(usage.totalTokens).toBe(3);
  });

  it('returns at least 1 for empty content', () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: '' }] };
    const usage = estimateUsage(req, '');

    expect(usage.promptTokens).toBeGreaterThanOrEqual(1);
    expect(usage.completionTokens).toBeGreaterThanOrEqual(1);
  });
});

// ====== normalizeMessages ================================================

describe('normalizeMessages()', () => {
  it('drops empty-content non-tool messages and preserves order', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: '' },           // dropped
      { role: 'user', content: '   ' },         // dropped (whitespace only)
      { role: 'assistant', content: 'Sure!' },
      { role: 'tool', content: '' },            // preserved — tool messages kept regardless
    ];

    const result = normalizeMessages(msgs);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ role: 'system', content: 'Be helpful.' });
    expect(result[1]).toMatchObject({ role: 'assistant', content: 'Sure!' });
    expect(result[2]).toMatchObject({ role: 'tool', content: '' });
  });

  it('preserves all messages when all have non-empty content', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];
    expect(normalizeMessages(msgs)).toHaveLength(3);
  });

  it('returns empty array for all-empty non-tool messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: '  ' },
    ];
    expect(normalizeMessages(msgs)).toHaveLength(0);
  });
});

// ====== classifyError ====================================================

describe('classifyError()', () => {
  it('returns "cancelled" for AbortError', () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    expect(classifyError(e)).toBe('cancelled');
  });

  it('returns "cancelled" for DOMException AbortError', () => {
    const e = new DOMException('Aborted', 'AbortError');
    expect(classifyError(e)).toBe('cancelled');
  });

  it('returns "transient" for ECONNRESET', () => {
    expect(classifyError(new Error('read ECONNRESET'))).toBe('transient');
  });

  it('returns "transient" for fetch failed', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('transient');
  });

  it('returns "transient" for 429 rate limit', () => {
    expect(classifyError(new Error('429 rate limit exceeded'))).toBe('transient');
  });

  it('returns "transient" for 503 service unavailable', () => {
    expect(classifyError(new Error('503 service unavailable'))).toBe('transient');
  });

  it('returns "permanent" for 400 bad_request', () => {
    expect(classifyError(new Error('400 bad_request'))).toBe('permanent');
  });

  it('returns "permanent" for invalid_api_key', () => {
    expect(classifyError(new Error('invalid_api_key: check your credentials'))).toBe('permanent');
  });

  it('returns "permanent" for non-Error values', () => {
    expect(classifyError('oops')).toBe('permanent');
    expect(classifyError(null)).toBe('permanent');
    expect(classifyError(42)).toBe('permanent');
  });
});
