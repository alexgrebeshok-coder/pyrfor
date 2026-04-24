// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai';

// ─── helpers ────────────────────────────────────────────────────────────────

function mockFetchSuccess(content: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    text: vi.fn().mockResolvedValue(''),
  });
}

function mockFetchFailure(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(body),
  });
}

function mockFetchNetworkError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ─── static properties ────────────────────────────────────────────────────

  it('has name = "openai"', () => {
    const provider = new OpenAIProvider('key');
    expect(provider.name).toBe('openai');
  });

  it('exposes expected models array', () => {
    const provider = new OpenAIProvider('key');
    expect(provider.models).toContain('gpt-4o');
    expect(provider.models.length).toBeGreaterThanOrEqual(1);
  });

  // ─── constructor ─────────────────────────────────────────────────────────

  it('constructor: uses explicit apiKey', async () => {
    global.fetch = mockFetchSuccess('hello');
    const provider = new OpenAIProvider('explicit-key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer explicit-key');
  });

  it('constructor: reads OPENAI_API_KEY from env when no argument given', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    global.fetch = mockFetchSuccess('hello');
    const provider = new OpenAIProvider();
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer env-key');
  });

  it('constructor: throws when no apiKey and env unset', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('OPENAI_API_KEY not set');
  });

  // ─── chat() request shape ─────────────────────────────────────────────────

  it('chat(): sends POST to /v1/chat/completions', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
  });

  it('chat(): sends correct Authorization header', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('my-api-key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer my-api-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('chat(): defaults to gpt-5.2 when model omitted', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5.2');
  });

  it('chat(): uses options.model when provided', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o');
  });

  it('chat(): passes messages array in request body', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    const messages = [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'What is 2+2?' },
    ];
    await provider.chat(messages);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages).toEqual(messages);
  });

  it('chat(): passes temperature from options', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }], { temperature: 0.2 });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.temperature).toBe(0.2);
  });

  it('chat(): passes maxTokens as max_tokens from options', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 512 });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(512);
  });

  it('chat(): uses default temperature 0.7 when omitted', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
  });

  it('chat(): uses default max_tokens 4096 when omitted', async () => {
    global.fetch = mockFetchSuccess('response');
    const provider = new OpenAIProvider('key');
    await provider.chat([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
  });

  // ─── chat() response parsing ──────────────────────────────────────────────

  it('chat(): returns content string from choices[0].message.content', async () => {
    global.fetch = mockFetchSuccess('The answer is 42.');
    const provider = new OpenAIProvider('key');
    const result = await provider.chat([{ role: 'user', content: 'What is the answer?' }]);
    expect(result).toBe('The answer is 42.');
  });

  // ─── chat() error handling ────────────────────────────────────────────────

  it('chat(): throws with status info on non-200 response', async () => {
    global.fetch = mockFetchFailure(401, 'Unauthorized');
    const provider = new OpenAIProvider('bad-key');
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('OpenAI API error: 401 - Unauthorized');
  });

  it('chat(): throws on 429 rate limit', async () => {
    global.fetch = mockFetchFailure(429, 'Rate limit exceeded');
    const provider = new OpenAIProvider('key');
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('429');
  });

  it('chat(): propagates network errors', async () => {
    global.fetch = mockFetchNetworkError('Failed to connect');
    const provider = new OpenAIProvider('key');
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('Failed to connect');
  });

  it('chat(): throws on 500 server error', async () => {
    global.fetch = mockFetchFailure(500, 'Internal Server Error');
    const provider = new OpenAIProvider('key');
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('500');
  });
});
