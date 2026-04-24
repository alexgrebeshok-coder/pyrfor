// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIJoraProvider } from './aijora';

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

const MESSAGES = [{ role: 'user' as const, content: 'Hi' }];

// ── tests ──────────────────────────────────────────────────────────────────

describe('AIJoraProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AIJORA_API_KEY;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "aijora"', () => {
    expect(new AIJoraProvider('k').name).toBe('aijora');
  });

  it('exposes a non-empty models array', () => {
    const p = new AIJoraProvider('k');
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models).toContain('gpt-4o-mini');
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads apiKey from env when not passed explicitly', async () => {
    process.env.AIJORA_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new AIJoraProvider().chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-key');
  });

  it('explicit constructor arg takes priority over env', async () => {
    process.env.AIJORA_API_KEY = 'env-key';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    await new AIJoraProvider('explicit-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-key');
  });

  // ── throws without credentials ──────────────────────────────────────────

  it('throws when apiKey is missing', async () => {
    const p = new AIJoraProvider('');
    await expect(p.chat(MESSAGES)).rejects.toThrow('AIJORA_API_KEY not set');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the chat/completions endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.aijora.com/api/v1/chat/completions');
  });

  it('sends POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sets Authorization: Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('my-key').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-key');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('falls back to default model gpt-4o-mini when omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('uses options.model when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES, { model: 'gpt-4o' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
  });

  it('passes temperature and max_tokens to body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES, { temperature: 0.3, maxTokens: 256 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(256);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    await new AIJoraProvider('k').chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('forwards messages array in body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const msgs = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Hello' },
    ];
    await new AIJoraProvider('k').chat(msgs);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(msgs);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('The answer is 42'));
    const result = await new AIJoraProvider('k').chat(MESSAGES);
    expect(result).toBe('The answer is 42');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 status with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'unauthorized'));
    await expect(new AIJoraProvider('k').chat(MESSAGES)).rejects.toThrow('401');
  });

  it('includes error body in thrown error message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'boom'));
    await expect(new AIJoraProvider('k').chat(MESSAGES)).rejects.toThrow('boom');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(new AIJoraProvider('k').chat(MESSAGES)).rejects.toThrow('connection refused');
  });
});
