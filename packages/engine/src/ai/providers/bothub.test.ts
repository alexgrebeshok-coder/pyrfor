// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BothubProvider } from './bothub';

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

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];

// ── tests ──────────────────────────────────────────────────────────────────

describe('BothubProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BOTHUB_API_KEY;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "bothub"', () => {
    expect(new BothubProvider('k').name).toBe('bothub');
  });

  it('exposes a non-empty models array', () => {
    const p = new BothubProvider('k');
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models).toContain('gpt-4o-mini');
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads apiKey from env when not passed explicitly', async () => {
    process.env.BOTHUB_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new BothubProvider().chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-key');
  });

  it('explicit constructor arg takes priority over env', async () => {
    process.env.BOTHUB_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new BothubProvider('explicit-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-key');
  });

  // ── throws without credentials ──────────────────────────────────────────

  it('throws when apiKey is missing', async () => {
    const p = new BothubProvider('');
    await expect(p.chat(MESSAGES)).rejects.toThrow('BOTHUB_API_KEY not set');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the chat/completions endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://bothub.chat/api/v1/chat/completions');
  });

  it('sends POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sets Authorization: Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('secret').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('falls back to default model gpt-4o-mini when omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('uses options.model when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES, { model: 'claude-3.5-sonnet' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-3.5-sonnet');
  });

  it('passes temperature and max_tokens to body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES, { temperature: 0.1, maxTokens: 1024 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(1024);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new BothubProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('forwards messages array in body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const msgs = [
      { role: 'system' as const, content: 'Be concise' },
      { role: 'user' as const, content: 'What is 2+2?' },
    ];
    await new BothubProvider('k').chat(msgs);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(msgs);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('four'));
    const result = await new BothubProvider('k').chat(MESSAGES);
    expect(result).toBe('four');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 status with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(403, 'forbidden'));
    await expect(new BothubProvider('k').chat(MESSAGES)).rejects.toThrow('403');
  });

  it('includes error body in thrown error message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(503, 'service unavailable'));
    await expect(new BothubProvider('k').chat(MESSAGES)).rejects.toThrow('service unavailable');
  });

  it('error message contains "Bothub" provider name', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'oops'));
    await expect(new BothubProvider('k').chat(MESSAGES)).rejects.toThrow(/Bothub/i);
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new BothubProvider('k').chat(MESSAGES)).rejects.toThrow('ECONNREFUSED');
  });
});
