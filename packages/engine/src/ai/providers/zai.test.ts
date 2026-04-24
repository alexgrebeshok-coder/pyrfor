// @vitest-environment node
/**
 * Tests for ZAIProvider — ZukiJourney proxy for GLM models.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZAIProvider } from './zai';

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

const MESSAGES = [{ role: 'user' as const, content: 'Hello ZAI' }];

// ── tests ──────────────────────────────────────────────────────────────────

describe('ZAIProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZAI_API_KEY;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "zai"', () => {
    expect(new ZAIProvider('key').name).toBe('zai');
  });

  it('exposes models array containing GLM variants', () => {
    const p = new ZAIProvider('key');
    expect(p.models).toContain('glm-5');
    expect(p.models).toContain('glm-4.7');
    expect(p.models.length).toBeGreaterThan(0);
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads ZAI_API_KEY from env when not passed explicitly', async () => {
    process.env.ZAI_API_KEY = 'env-zai-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new ZAIProvider().chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-zai-key');
  });

  it('explicit apiKey takes priority over env', async () => {
    process.env.ZAI_API_KEY = 'env-zai-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new ZAIProvider('explicit-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-key');
  });

  // ── missing apiKey ──────────────────────────────────────────────────────

  it('throws "ZAI_API_KEY not set" when apiKey is empty', async () => {
    await expect(new ZAIProvider('').chat(MESSAGES)).rejects.toThrow('ZAI_API_KEY not set');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the ZukiJourney chat/completions endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.zukijourney.com/v1/chat/completions');
  });

  it('sends POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sets Authorization: Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('my-zai-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-zai-key');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('falls back to default model "glm-5" when options.model omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('glm-5');
  });

  it('uses options.model when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES, { model: 'glm-4.7-flash' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('glm-4.7-flash');
  });

  it('passes temperature and max_tokens to body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES, { temperature: 0.1, maxTokens: 1024 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(1024);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new ZAIProvider('key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('forwards the messages array in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const msgs = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Hello' },
    ];
    await new ZAIProvider('key').chat(msgs);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(msgs);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Response from ZAI'));
    const result = await new ZAIProvider('key').chat(MESSAGES);
    expect(result).toBe('Response from ZAI');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 status with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'rate limited'));
    await expect(new ZAIProvider('key').chat(MESSAGES)).rejects.toThrow('429');
  });

  it('includes error body text in thrown error', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'internal server error'));
    await expect(new ZAIProvider('key').chat(MESSAGES)).rejects.toThrow('internal server error');
  });

  it('error message includes "ZAI API error"', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(403, 'forbidden'));
    await expect(new ZAIProvider('key').chat(MESSAGES)).rejects.toThrow('ZAI API error');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('DNS resolution failed'));
    await expect(new ZAIProvider('key').chat(MESSAGES)).rejects.toThrow('DNS resolution failed');
  });
});
