// @vitest-environment node
/**
 * Tests for ZhipuProvider — Zhipu AI (api.z.ai), GLM model family.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhipuProvider } from './zhipu';

// ── helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    text: vi.fn().mockResolvedValue(''),
  };
}

function makeErrorResponse(status: number, body = 'server error') {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  };
}

/** Build a minimal SSE stream body reader from a list of delta content strings. */
function makeSseReader(deltas: string[], includeDone = true) {
  const lines = deltas.map(d =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
  );
  if (includeDone) lines.push('data: [DONE]\n\n');
  const full = lines.join('');
  const encoded = new TextEncoder().encode(full);
  let done = false;

  return {
    read: vi.fn(async () => {
      if (done) return { done: true as const, value: undefined };
      done = true;
      return { done: false as const, value: encoded };
    }),
    cancel: vi.fn(),
    releaseLock: vi.fn(),
  };
}

const MESSAGES = [{ role: 'user' as const, content: 'Hello Zhipu' }];

// ── tests ──────────────────────────────────────────────────────────────────

describe('ZhipuProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_BASE_URL;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "zhipu"', () => {
    expect(new ZhipuProvider('key').name).toBe('zhipu');
  });

  it('exposes models array containing GLM variants', () => {
    const p = new ZhipuProvider('key');
    expect(p.models).toContain('glm-5');
    expect(p.models).toContain('glm-5-turbo');
    expect(p.models).toContain('glm-4');
    expect(p.models.length).toBeGreaterThan(0);
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads ZHIPU_API_KEY from env when not passed explicitly', async () => {
    process.env.ZHIPU_API_KEY = 'env-zhipu-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new ZhipuProvider().chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-zhipu-key');
  });

  it('explicit apiKey takes priority over env', async () => {
    process.env.ZHIPU_API_KEY = 'env-zhipu-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new ZhipuProvider('explicit-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-key');
  });

  it('reads ZHIPU_BASE_URL from env', async () => {
    process.env.ZHIPU_API_KEY = 'key';
    process.env.ZHIPU_BASE_URL = 'https://custom.zhipu.example.com/v1';
    fetchMock.mockResolvedValue(makeOkResponse('ok'));

    await new ZhipuProvider().chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://custom.zhipu.example.com/v1/chat/completions');
  });

  it('uses default baseUrl when ZHIPU_BASE_URL is not set', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));

    await new ZhipuProvider('key').chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.z.ai/api/coding/paas/v4/chat/completions');
  });

  // ── missing apiKey ──────────────────────────────────────────────────────

  it('throws "ZHIPU_API_KEY not set" when apiKey is empty', async () => {
    const p = new ZhipuProvider('');
    await expect(p.chat(MESSAGES)).rejects.toThrow('ZHIPU_API_KEY not set');
  });

  it('chatStream() also throws "ZHIPU_API_KEY not set" when apiKey is empty', async () => {
    const p = new ZhipuProvider('');
    const gen = p.chatStream!(MESSAGES);
    await expect(gen.next()).rejects.toThrow('ZHIPU_API_KEY not set');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the chat/completions endpoint via POST', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chat/completions');
    expect(init.method).toBe('POST');
  });

  it('sets Authorization: Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('my-api-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-api-key');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('falls back to default model "glm-5-turbo" when options.model omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('glm-5-turbo');
  });

  it('uses options.model when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES, { model: 'glm-4.7' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('glm-4.7');
  });

  it('passes temperature and max_tokens to body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES, { temperature: 0.2, maxTokens: 512 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(512);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZhipuProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('forwards the messages array in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const msgs = [
      { role: 'system' as const, content: 'Be helpful' },
      { role: 'user' as const, content: 'What is GLM?' },
    ];
    await new ZhipuProvider('key').chat(msgs);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(msgs);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('GLM is a language model'));
    const result = await new ZhipuProvider('key').chat(MESSAGES);
    expect(result).toBe('GLM is a language model');
  });

  it('returns empty string when choices array is empty', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ choices: [] }),
      text: vi.fn().mockResolvedValue(''),
    });
    const result = await new ZhipuProvider('key').chat(MESSAGES);
    expect(result).toBe('');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 status with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'rate limited'));
    await expect(new ZhipuProvider('key').chat(MESSAGES)).rejects.toThrow('429');
  });

  it('includes error body text in thrown error', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'internal server error'));
    await expect(new ZhipuProvider('key').chat(MESSAGES)).rejects.toThrow('internal server error');
  });

  it('error message includes "Zhipu API error"', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'unauthorized'));
    await expect(new ZhipuProvider('key').chat(MESSAGES)).rejects.toThrow('Zhipu API error');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new ZhipuProvider('key').chat(MESSAGES)).rejects.toThrow('ECONNREFUSED');
  });

  // ── chatStream ───────────────────────────────────────────────────────────

  it('chatStream() throws on non-200 status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });

    const p = new ZhipuProvider('key');
    const gen = p.chatStream!(MESSAGES);
    await expect(gen.next()).rejects.toThrow('503');
  });

  it('chatStream() yields delta content chunks from SSE stream', async () => {
    const reader = makeSseReader(['Hello', ' world', '!']);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: vi.fn().mockReturnValue(reader) },
    });

    const p = new ZhipuProvider('key');
    const chunks: string[] = [];
    for await (const chunk of p.chatStream!(MESSAGES)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('chatStream() includes stream: true in request body', async () => {
    const reader = makeSseReader([]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: vi.fn().mockReturnValue(reader) },
    });

    await new ZhipuProvider('key').chatStream!(MESSAGES).next();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });
});
