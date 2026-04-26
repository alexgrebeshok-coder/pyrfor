import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCloudFallbackConfig,
  setCloudFallbackConfig,
  chatStreamCloud,
  CloudFallbackUnavailableError,
} from '../cloudFallback';

// ─── localStorage mock ────────────────────────────────────────────────────────

const store: Record<string, string> = {};

beforeEach(() => {
  // Reset store between tests
  for (const k of Object.keys(store)) delete store[k];

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
    configurable: true,
  });

  vi.restoreAllMocks();
});

// ─── getCloudFallbackConfig ───────────────────────────────────────────────────

describe('getCloudFallbackConfig', () => {
  it('returns defaults when localStorage is empty', () => {
    const cfg = getCloudFallbackConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(cfg.apiKey).toBeNull();
    expect(cfg.model).toBe('openrouter/auto');
  });

  it('merges persisted values with defaults', () => {
    store['pyrfor.cloudFallback.v1'] = JSON.stringify({ enabled: true, model: 'custom/model' });
    const cfg = getCloudFallbackConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.model).toBe('custom/model');
    // Default still provided for missing keys
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('returns defaults when localStorage has corrupted JSON', () => {
    store['pyrfor.cloudFallback.v1'] = 'not-json{{{';
    const cfg = getCloudFallbackConfig();
    expect(cfg.enabled).toBe(false);
  });
});

// ─── setCloudFallbackConfig ───────────────────────────────────────────────────

describe('setCloudFallbackConfig', () => {
  it('persists and reads back', () => {
    setCloudFallbackConfig({ enabled: true, apiKey: 'sk-test-key', model: 'openrouter/gpt-4' });
    const cfg = getCloudFallbackConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('sk-test-key');
    expect(cfg.model).toBe('openrouter/gpt-4');
  });

  it('does a partial update, preserving other fields', () => {
    setCloudFallbackConfig({ enabled: true, apiKey: 'first-key' });
    setCloudFallbackConfig({ model: 'openrouter/claude-3' });
    const cfg = getCloudFallbackConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('first-key');
    expect(cfg.model).toBe('openrouter/claude-3');
  });
});

// ─── chatStreamCloud ──────────────────────────────────────────────────────────

describe('chatStreamCloud', () => {
  it('throws CloudFallbackUnavailableError when disabled', async () => {
    setCloudFallbackConfig({ enabled: false, apiKey: 'sk-key' });
    await expect(
      chatStreamCloud({ text: 'hi', onChunk: () => {} })
    ).rejects.toThrow(CloudFallbackUnavailableError);
  });

  it('throws CloudFallbackUnavailableError when no API key', async () => {
    setCloudFallbackConfig({ enabled: true, apiKey: null });
    await expect(
      chatStreamCloud({ text: 'hi', onChunk: () => {} })
    ).rejects.toThrow(CloudFallbackUnavailableError);
  });

  it('throws CloudFallbackUnavailableError (not generic Error) for disabled', async () => {
    setCloudFallbackConfig({ enabled: false, apiKey: null });
    const err = await chatStreamCloud({ text: 'hi', onChunk: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(CloudFallbackUnavailableError);
    expect(err.name).toBe('CloudFallbackUnavailableError');
  });

  it('POSTs correct OpenAI-shape body and parses SSE deltas', async () => {
    setCloudFallbackConfig({ enabled: true, apiKey: 'sk-test', model: 'openrouter/auto', baseUrl: 'https://openrouter.ai/api/v1' });

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: [DONE]\n',
    ];

    let chunkIndex = 0;
    const encoder = new TextEncoder();

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < sseChunks.length) {
          return Promise.resolve({
            done: false,
            value: encoder.encode(sseChunks[chunkIndex++]),
          });
        }
        return Promise.resolve({ done: true, value: undefined });
      }),
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: { getReader: () => mockReader },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce(mockResponse);
    globalThis.fetch = mockFetch as any;

    const chunks: string[] = [];
    await chatStreamCloud({
      text: 'Say hello',
      sessionId: 'sess-1',
      openFiles: [{ path: 'foo.ts', content: 'const x = 1;', language: 'typescript' }],
      workspace: '/home/user/project',
      onChunk: (t) => chunks.push(t),
    });

    expect(chunks).toEqual(['Hello', ' world']);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');

    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.model).toBe('openrouter/auto');
    expect(sentBody.messages[0].role).toBe('system');
    expect(sentBody.messages[1].role).toBe('user');
    expect(sentBody.messages[1].content).toBe('Say hello');
    // System message should include open file info
    expect(sentBody.messages[0].content).toContain('foo.ts');
    expect(sentBody.messages[0].content).toContain('/home/user/project');
  });

  it('throws on non-ok HTTP response from cloud', async () => {
    setCloudFallbackConfig({ enabled: true, apiKey: 'sk-test' });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, body: null }) as any;
    await expect(
      chatStreamCloud({ text: 'hi', onChunk: () => {} })
    ).rejects.toThrow('401');
  });
});
