// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from './ollama';

// ─── helpers ────────────────────────────────────────────────────────────────

function mockFetchChat(content: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ message: { content } }),
    text: vi.fn().mockResolvedValue(`error ${status}`),
  });
}

function mockFetchFailure(status: number, body = 'Bad Request') {
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

/** Build a fetch mock that streams NDJSON ollama chunks via body.getReader() */
function mockFetchStream(
  chunks: Array<{ message?: { content: string }; done?: boolean }>,
  status = 200,
) {
  const encoder = new TextEncoder();
  const lines = chunks.map(c => JSON.stringify(c) + '\n');
  const combined = lines.join('');
  const encoded = encoder.encode(combined);

  let consumed = false;
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (!consumed) {
        consumed = true;
        return Promise.resolve({ done: false, value: encoded });
      }
      return Promise.resolve({ done: true, value: undefined });
    }),
  };

  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: { getReader: () => reader },
    text: vi.fn().mockResolvedValue('error'),
    json: vi.fn(),
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('OllamaProvider', () => {
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

  it('has name = "ollama"', () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe('ollama');
  });

  it('exposes expected models array including qwen2.5:3b', () => {
    const provider = new OllamaProvider();
    expect(provider.models).toContain('qwen2.5:3b');
    expect(provider.models.length).toBeGreaterThan(0);
  });

  // ─── constructor ─────────────────────────────────────────────────────────

  it('constructor: uses default localhost:11434 when no arg and no env', async () => {
    delete process.env.OLLAMA_BASE_URL;
    global.fetch = mockFetchChat('hi');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('constructor: uses OLLAMA_BASE_URL env var', async () => {
    process.env.OLLAMA_BASE_URL = 'http://my-server:9999';
    global.fetch = mockFetchChat('hi');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://my-server:9999/api/chat');
  });

  it('constructor: explicit baseUrl overrides env var', async () => {
    process.env.OLLAMA_BASE_URL = 'http://should-be-ignored:1234';
    global.fetch = mockFetchChat('hi');
    const provider = new OllamaProvider('http://explicit:5678');
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://explicit:5678/api/chat');
  });

  // ─── chat() request shape ─────────────────────────────────────────────────

  it('chat(): sends POST to /api/chat', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('chat(): sets stream: false in request body', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.stream).toBe(false);
  });

  it('chat(): uses default model qwen2.5:3b when model omitted', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('qwen2.5:3b');
  });

  it('chat(): uses options.model when provided', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }], { model: 'llama3' });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('llama3');
  });

  it('chat(): passes messages array in request body', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    const messages = [
      { role: 'system' as const, content: 'Be helpful.' },
      { role: 'user' as const, content: 'Hello!' },
    ];
    await provider.chat(messages);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages).toEqual(messages);
  });

  it('chat(): passes temperature as options.temperature', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }], { temperature: 0.3 });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0.3);
  });

  it('chat(): passes maxTokens as num_predict in options', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }], { maxTokens: 2048 });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(2048);
  });

  it('chat(): uses default temperature 0.7 when omitted', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0.7);
  });

  it('chat(): uses default num_predict 1024 when maxTokens omitted', async () => {
    global.fetch = mockFetchChat('ok');
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(1024);
  });

  // ─── chat() response parsing ──────────────────────────────────────────────

  it('chat(): returns message.content from response', async () => {
    global.fetch = mockFetchChat('The sky is blue.');
    const provider = new OllamaProvider();
    const result = await provider.chat([{ role: 'user', content: 'What color is the sky?' }]);
    expect(result).toBe('The sky is blue.');
  });

  it('chat(): returns empty string when message.content is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ message: {} }),
      text: vi.fn(),
    });
    const provider = new OllamaProvider();
    const result = await provider.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('');
  });

  // ─── chat() error handling ────────────────────────────────────────────────

  it('chat(): throws with status info on non-200 response', async () => {
    global.fetch = mockFetchFailure(500, 'Internal Server Error');
    const provider = new OllamaProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('Ollama error: 500 - Internal Server Error');
  });

  it('chat(): throws on 404', async () => {
    global.fetch = mockFetchFailure(404, 'model not found');
    const provider = new OllamaProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('404');
  });

  it('chat(): propagates network errors', async () => {
    global.fetch = mockFetchNetworkError('ECONNREFUSED');
    const provider = new OllamaProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('ECONNREFUSED');
  });

  // ─── chatStream() ─────────────────────────────────────────────────────────

  it('chatStream(): streams content chunks from NDJSON response', async () => {
    global.fetch = mockFetchStream([
      { message: { content: 'Hello' } },
      { message: { content: ' world' } },
      { done: true },
    ]);
    const provider = new OllamaProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('chatStream(): sets stream: true in request body', async () => {
    global.fetch = mockFetchStream([{ done: true }]);
    const provider = new OllamaProvider();
    // Consume the generator
    for await (const _chunk of provider.chatStream!([{ role: 'user', content: 'hi' }])) { /* noop */ }

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  it('chatStream(): uses default model qwen2.5:3b when omitted', async () => {
    global.fetch = mockFetchStream([{ done: true }]);
    const provider = new OllamaProvider();
    for await (const _chunk of provider.chatStream!([{ role: 'user', content: 'hi' }])) { /* noop */ }

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('qwen2.5:3b');
  });

  it('chatStream(): throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });
    const provider = new OllamaProvider();
    const gen = provider.chatStream!([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('Ollama error: 503 - Service Unavailable');
  });

  it('chatStream(): throws when response body is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });
    const provider = new OllamaProvider();
    const gen = provider.chatStream!([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('No response body');
  });

  it('chatStream(): skips malformed JSON lines without crashing', async () => {
    const encoder = new TextEncoder();
    const lines =
      'not-json\n' +
      JSON.stringify({ message: { content: 'good' } }) + '\n' +
      JSON.stringify({ done: true }) + '\n';
    const encoded = encoder.encode(lines);
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (!consumed) { consumed = true; return Promise.resolve({ done: false, value: encoded }); }
        return Promise.resolve({ done: true, value: undefined });
      }),
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: { getReader: () => reader },
    });
    const provider = new OllamaProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['good']);
  });

  // ─── isAvailable() ────────────────────────────────────────────────────────

  it('isAvailable(): returns true when /api/tags responds ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const provider = new OllamaProvider();
    expect(await provider.isAvailable()).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/tags');
  });

  it('isAvailable(): returns false when response not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const provider = new OllamaProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it('isAvailable(): returns false on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OllamaProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  // ─── listModels() ────────────────────────────────────────────────────────

  it('listModels(): returns model name array from /api/tags', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [{ name: 'llama3' }, { name: 'mistral' }],
      }),
    });
    const provider = new OllamaProvider();
    expect(await provider.listModels()).toEqual(['llama3', 'mistral']);
  });

  it('listModels(): returns empty array when response not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const provider = new OllamaProvider();
    expect(await provider.listModels()).toEqual([]);
  });

  it('listModels(): returns empty array on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    const provider = new OllamaProvider();
    expect(await provider.listModels()).toEqual([]);
  });

  it('listModels(): returns empty array when models key absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    const provider = new OllamaProvider();
    expect(await provider.listModels()).toEqual([]);
  });
});
