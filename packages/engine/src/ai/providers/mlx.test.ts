// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MlxProvider } from './mlx';

// ─── helpers ────────────────────────────────────────────────────────────────

function mockFetchModels(models: string[], status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ data: models.map(id => ({ id })) }),
    text: vi.fn().mockResolvedValue(`error ${status}`),
  });
}

function mockFetchChat(content: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
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

/** Build a fetch mock that streams SSE chunks via body.getReader() */
function mockFetchStream(
  deltas: Array<string | null>,
  status = 200,
) {
  const encoder = new TextEncoder();
  const lines = deltas
    .map(d =>
      d === null
        ? 'data: [DONE]\n'
        : `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n`,
    )
    .join('');
  const encoded = encoder.encode(lines);

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

describe('MlxProvider', () => {
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

  it('has name = "mlx"', () => {
    expect(new MlxProvider().name).toBe('mlx');
  });

  // ─── constructor ─────────────────────────────────────────────────────────

  it('uses default localhost:8080 when no arg and no env', async () => {
    delete process.env.PYRFOR_MLX_BASE_URL;
    global.fetch = mockFetchChat('hi');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('http://localhost:8080');
  });

  it('uses PYRFOR_MLX_BASE_URL env var', async () => {
    process.env.PYRFOR_MLX_BASE_URL = 'http://mlx-server:9090';
    global.fetch = mockFetchChat('hi');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('http://mlx-server:9090');
  });

  it('explicit baseUrl overrides env var', async () => {
    process.env.PYRFOR_MLX_BASE_URL = 'http://should-be-ignored:1234';
    global.fetch = mockFetchChat('hi');
    await new MlxProvider({ baseUrl: 'http://explicit:5678' }).chat([{ role: 'user', content: 'hello' }]);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('http://explicit:5678');
  });

  // ─── isAvailable() ────────────────────────────────────────────────────────

  it('isAvailable(): returns true when /v1/models responds 200 with ≥1 model', async () => {
    global.fetch = mockFetchModels(['mlx-community/Llama-3.2-3B-Instruct-4bit']);
    expect(await new MlxProvider().isAvailable()).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/v1/models');
  });

  it('isAvailable(): returns false when response not ok', async () => {
    global.fetch = mockFetchFailure(503);
    expect(await new MlxProvider().isAvailable()).toBe(false);
  });

  it('isAvailable(): returns false when data array is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });
    expect(await new MlxProvider().isAvailable()).toBe(false);
  });

  it('isAvailable(): returns false on network error / timeout', async () => {
    global.fetch = mockFetchNetworkError('TimeoutError');
    expect(await new MlxProvider().isAvailable()).toBe(false);
  });

  // ─── listModels() ─────────────────────────────────────────────────────────

  it('listModels(): returns id array from /v1/models', async () => {
    global.fetch = mockFetchModels(['model-a', 'model-b']);
    expect(await new MlxProvider().listModels()).toEqual(['model-a', 'model-b']);
  });

  it('listModels(): returns empty array when response not ok', async () => {
    global.fetch = mockFetchFailure(500);
    expect(await new MlxProvider().listModels()).toEqual([]);
  });

  it('listModels(): returns empty array on network error', async () => {
    global.fetch = mockFetchNetworkError('ECONNREFUSED');
    expect(await new MlxProvider().listModels()).toEqual([]);
  });

  it('listModels(): returns empty array when data key absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    expect(await new MlxProvider().listModels()).toEqual([]);
  });

  // ─── chat() request shape ─────────────────────────────────────────────────

  it('chat(): sends POST to /v1/chat/completions', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('chat(): sends no Authorization header', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('chat(): sets stream: false in request body', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.stream).toBe(false);
  });

  it('chat(): uses options.model when provided', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }], { model: 'my-model' });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('my-model');
  });

  it('chat(): passes messages in request body', async () => {
    global.fetch = mockFetchChat('ok');
    const messages = [
      { role: 'system' as const, content: 'Be helpful.' },
      { role: 'user' as const, content: 'Hello!' },
    ];
    await new MlxProvider().chat(messages);
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages).toEqual(messages);
  });

  it('chat(): uses default temperature 0.7', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
  });

  it('chat(): uses default max_tokens 1024', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }]);
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1024);
  });

  it('chat(): passes options.temperature', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }], { temperature: 0.2 });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.temperature).toBe(0.2);
  });

  it('chat(): passes options.maxTokens as max_tokens', async () => {
    global.fetch = mockFetchChat('ok');
    await new MlxProvider().chat([{ role: 'user', content: 'hello' }], { maxTokens: 2048 });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(2048);
  });

  // ─── chat() response parsing ──────────────────────────────────────────────

  it('chat(): returns choices[0].message.content', async () => {
    global.fetch = mockFetchChat('The sky is blue.');
    const result = await new MlxProvider().chat([{ role: 'user', content: 'What color is the sky?' }]);
    expect(result).toBe('The sky is blue.');
  });

  // ─── chat() error handling ────────────────────────────────────────────────

  it('chat(): throws with status info on non-200 response', async () => {
    global.fetch = mockFetchFailure(500, 'Internal Server Error');
    await expect(new MlxProvider().chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('MLX error: 500 - Internal Server Error');
  });

  it('chat(): propagates network errors', async () => {
    global.fetch = mockFetchNetworkError('ECONNREFUSED');
    await expect(new MlxProvider().chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('ECONNREFUSED');
  });

  // ─── chatStream() ─────────────────────────────────────────────────────────

  it('chatStream(): streams SSE delta content', async () => {
    global.fetch = mockFetchStream(['Hello', ' world', null]);
    const chunks: string[] = [];
    for await (const chunk of new MlxProvider().chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('chatStream(): sets stream: true in request body', async () => {
    global.fetch = mockFetchStream([null]);
    for await (const _chunk of new MlxProvider().chatStream([{ role: 'user', content: 'hi' }])) { /* noop */ }
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  it('chatStream(): throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });
    const gen = new MlxProvider().chatStream([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('MLX error: 503 - Service Unavailable');
  });

  it('chatStream(): throws when response body is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });
    const gen = new MlxProvider().chatStream([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('No response body');
  });

  it('chatStream(): skips malformed SSE lines without crashing', async () => {
    const encoder = new TextEncoder();
    const lines =
      'data: not-json\n' +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'good' } }] })}\n` +
      'data: [DONE]\n';
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
    const chunks: string[] = [];
    for await (const chunk of new MlxProvider().chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['good']);
  });
});
