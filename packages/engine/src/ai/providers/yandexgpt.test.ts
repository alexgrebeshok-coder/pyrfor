// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YandexGPTProvider } from './yandexgpt';

// ── helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      result: { alternatives: [{ message: { text } }] },
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

describe('YandexGPTProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YANDEXGPT_API_KEY;
    delete process.env.YANDEX_FOLDER_ID;
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "yandexgpt"', () => {
    const p = new YandexGPTProvider('key', 'folder');
    expect(p.name).toBe('yandexgpt');
  });

  it('exposes a non-empty models array', () => {
    const p = new YandexGPTProvider('key', 'folder');
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models).toContain('yandexgpt-lite');
    expect(p.models).toContain('yandexgpt');
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads apiKey and folderId from env when not passed explicitly', async () => {
    process.env.YANDEXGPT_API_KEY = 'env-key';
    process.env.YANDEX_FOLDER_ID = 'env-folder';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    const p = new YandexGPTProvider();
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Api-Key env-key');
    const body = JSON.parse(init.body as string);
    expect(body.modelUri).toContain('env-folder');
  });

  it('explicit constructor args take priority over env', async () => {
    process.env.YANDEXGPT_API_KEY = 'env-key';
    process.env.YANDEX_FOLDER_ID = 'env-folder';
    fetchMock.mockResolvedValue(makeOkResponse('hi'));

    const p = new YandexGPTProvider('explicit-key', 'explicit-folder');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Api-Key explicit-key');
    const body = JSON.parse(init.body as string);
    expect(body.modelUri).toContain('explicit-folder');
  });

  // ── throws without credentials ──────────────────────────────────────────

  it('throws when apiKey is missing', async () => {
    const p = new YandexGPTProvider('', 'folder');
    await expect(p.chat(MESSAGES)).rejects.toThrow('YANDEXGPT_API_KEY');
  });

  it('throws when folderId is missing', async () => {
    const p = new YandexGPTProvider('key', '');
    await expect(p.chat(MESSAGES)).rejects.toThrow('YANDEX_FOLDER_ID');
  });

  // ── request shape ────────────────────────────────────────────────────────

  it('calls the correct YandexGPT endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
  });

  it('sets Authorization header with Api-Key scheme', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('my-api-key', 'my-folder');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Api-Key my-api-key');
  });

  it('sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('builds modelUri as gpt://<folderId>/<model>', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'my-folder');
    await p.chat(MESSAGES, { model: 'yandexgpt' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.modelUri).toBe('gpt://my-folder/yandexgpt');
  });

  it('falls back to models[0] when options.model is omitted', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.modelUri).toContain(p.models[0]);
  });

  it('maps message content to `text` field in body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat([{ role: 'user', content: 'test msg' }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'user', text: 'test msg' });
  });

  it('passes temperature and maxTokens via completionOptions', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES, { temperature: 0.2, maxTokens: 512 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.completionOptions.temperature).toBe(0.2);
    expect(body.completionOptions.maxTokens).toBe('512');
  });

  it('uses default temperature=0.6 and maxTokens=4096 when not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.completionOptions.temperature).toBe(0.6);
    expect(body.completionOptions.maxTokens).toBe('4096');
  });

  it('sets stream: false in completionOptions', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('ok'));
    const p = new YandexGPTProvider('k', 'f');
    await p.chat(MESSAGES);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.completionOptions.stream).toBe(false);
  });

  // ── success response parsing ─────────────────────────────────────────────

  it('returns the text from the first alternative', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Hello world'));
    const p = new YandexGPTProvider('k', 'f');
    const result = await p.chat(MESSAGES);
    expect(result).toBe('Hello world');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws on non-200 with status code in message', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'rate limited'));
    const p = new YandexGPTProvider('k', 'f');
    await expect(p.chat(MESSAGES)).rejects.toThrow('429');
  });

  it('includes error body text in thrown error', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'internal error'));
    const p = new YandexGPTProvider('k', 'f');
    await expect(p.chat(MESSAGES)).rejects.toThrow('internal error');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));
    const p = new YandexGPTProvider('k', 'f');
    await expect(p.chat(MESSAGES)).rejects.toThrow('network failure');
  });
});
