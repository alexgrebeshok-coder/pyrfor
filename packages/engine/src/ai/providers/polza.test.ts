// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PolzaProvider } from './polza';

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

describe('PolzaProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POLZA_API_KEY;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "polza"', () => {
    expect(new PolzaProvider('k').name).toBe('polza');
  });

  it('exposes a non-empty models array with namespaced model ids', () => {
    const p = new PolzaProvider('k');
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models).toContain('openai/gpt-4o-mini');
    expect(p.models).toContain('anthropic/claude-3.5-sonnet');
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads apiKey from env when not passed explicitly', async () => {
    process.env.POLZA_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new PolzaProvider().chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-key');
  });

  it('explicit constructor arg takes priority over env', async () => {
    process.env.POLZA_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new PolzaProvider('explicit-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-key');
  });

  // ── throws without credentials ──────────────────────────────────────────

  it('throws when apiKey is missing', async () => {
    const p = new PolzaProvider('');
    await expect(p.chat(MESSAGES)).rejects.toThrow('POLZA_API_KEY not set');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the chat/completions endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://polza.ai/api/v1/chat/completions');
  });

  it('sends POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sets Authorization: Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('polza-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer polza-key');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('falls back to default model openai/gpt-4o-mini when omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('openai/gpt-4o-mini');
  });

  it('uses options.model when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES, { model: 'anthropic/claude-3-haiku' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('anthropic/claude-3-haiku');
  });

  it('passes temperature and max_tokens to body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES, { temperature: 0.5, maxTokens: 2048 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(2048);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new PolzaProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('forwards messages array in body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const msgs = [
      { role: 'system' as const, content: 'Be precise' },
      { role: 'user' as const, content: 'Explain quantum computing' },
    ];
    await new PolzaProvider('k').chat(msgs);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(msgs);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('quantum entanglement'));
    const result = await new PolzaProvider('k').chat(MESSAGES);
    expect(result).toBe('quantum entanglement');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 status with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(422, 'unprocessable'));
    await expect(new PolzaProvider('k').chat(MESSAGES)).rejects.toThrow('422');
  });

  it('includes error body in thrown error message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(502, 'bad gateway'));
    await expect(new PolzaProvider('k').chat(MESSAGES)).rejects.toThrow('bad gateway');
  });

  it('error message contains "Polza" provider name', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'err'));
    await expect(new PolzaProvider('k').chat(MESSAGES)).rejects.toThrow(/Polza/i);
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(new PolzaProvider('k').chat(MESSAGES)).rejects.toThrow('fetch failed');
  });
});
