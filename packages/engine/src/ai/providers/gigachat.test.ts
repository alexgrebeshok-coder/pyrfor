// @vitest-environment node
/**
 * Tests for GigaChatProvider — Sber GigaChat.
 *
 * GigaChat uses Node's native `https` module (not fetch) for both the OAuth
 * token endpoint and the chat endpoint.  vi.mock('https') cannot intercept
 * CJS require() calls to Node built-ins, so we monkey-patch the module
 * object directly via createRequire (which shares the same CJS cache).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { GigaChatProvider } from './gigachat';

// ── module-level reference to the real https exports (shared CJS cache) ──────
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpsModule = nodeRequire('https') as { request: (...args: unknown[]) => unknown };

// ── types & helpers ────────────────────────────────────────────────────────

type ReqCallback = (res: MockRes) => void;

interface MockRes {
  statusCode: number;
  on: (event: string, handler: (data?: Buffer) => void) => MockRes;
}

interface MockReq {
  on: (event: string, handler: (err: Error) => void) => MockReq;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

let mockRequest: ReturnType<typeof vi.fn>;
let origRequest: typeof httpsModule.request;

/**
 * Queue a synthetic HTTPS response for the next mockRequest call.
 * Returns the mock req so callers can inspect .write calls.
 */
function queueResponse(statusCode: number, body: unknown): MockReq {
  const mockReq: MockReq = {
    on: vi.fn().mockReturnThis(),
    write: vi.fn(),
    end: vi.fn(),
  };

  mockRequest.mockImplementationOnce((_opts: unknown, callback: ReqCallback) => {
    const res: MockRes = {
      statusCode,
      on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
        if (event === 'data') handler(Buffer.from(JSON.stringify(body)));
        if (event === 'end') handler();
        return res;
      }),
    };
    callback(res);
    return mockReq;
  });

  return mockReq;
}

/**
 * Queue a successful OAuth token response, then a chat response.
 * Returns the chat mock req so callers can inspect the written body.
 */
function queueTokenThenChat(chatStatusCode: number, chatBody: unknown): MockReq {
  queueResponse(200, { access_token: 'test-token-abc' });
  return queueResponse(chatStatusCode, chatBody);
}

const MESSAGES = [{ role: 'user' as const, content: 'Привет, GigaChat!' }];
const OK_BODY = { choices: [{ message: { content: 'Привет!' } }] };

// ── tests ──────────────────────────────────────────────────────────────────

describe('GigaChatProvider', () => {
  beforeEach(() => {
    origRequest = httpsModule.request;
    mockRequest = vi.fn();
    httpsModule.request = mockRequest as unknown as typeof httpsModule.request;
  });

  afterEach(() => {
    httpsModule.request = origRequest;
    delete process.env.GIGACHAT_CLIENT_ID;
    delete process.env.GIGACHAT_CLIENT_SECRET;
    vi.useRealTimers();
  });

  // ── static properties ───────────────────────────────────────────────────

  it('exposes name = "gigachat"', () => {
    expect(new GigaChatProvider('id', 'secret').name).toBe('gigachat');
  });

  it('exposes models array containing GigaChat variants', () => {
    const p = new GigaChatProvider('id', 'secret');
    expect(p.models).toContain('GigaChat');
    expect(p.models).toContain('GigaChat-Plus');
    expect(p.models).toContain('GigaChat-Pro');
    expect(p.models.length).toBeGreaterThan(0);
  });

  // ── constructor ─────────────────────────────────────────────────────────

  it('reads GIGACHAT_CLIENT_ID and GIGACHAT_CLIENT_SECRET from env', async () => {
    process.env.GIGACHAT_CLIENT_ID = 'env-client-id';
    process.env.GIGACHAT_CLIENT_SECRET = 'env-client-secret';
    queueTokenThenChat(200, OK_BODY);

    await new GigaChatProvider().chat(MESSAGES);

    const [tokenOpts] = mockRequest.mock.calls[0] as [Record<string, unknown>, ReqCallback];
    const expectedCreds = Buffer.from('env-client-id:env-client-secret').toString('base64');
    expect((tokenOpts.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${expectedCreds}`,
    );
  });

  it('explicit constructor args take priority over env', async () => {
    process.env.GIGACHAT_CLIENT_ID = 'env-id';
    process.env.GIGACHAT_CLIENT_SECRET = 'env-secret';
    queueTokenThenChat(200, OK_BODY);

    await new GigaChatProvider('explicit-id', 'explicit-secret').chat(MESSAGES);

    const [tokenOpts] = mockRequest.mock.calls[0] as [Record<string, unknown>, ReqCallback];
    const expectedCreds = Buffer.from('explicit-id:explicit-secret').toString('base64');
    expect((tokenOpts.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${expectedCreds}`,
    );
  });

  // ── missing credentials ─────────────────────────────────────────────────

  it('throws when clientId is missing', async () => {
    await expect(new GigaChatProvider('', 'secret').chat(MESSAGES)).rejects.toThrow(
      'GIGACHAT_CLIENT_ID',
    );
  });

  it('throws when clientSecret is missing', async () => {
    await expect(new GigaChatProvider('id', '').chat(MESSAGES)).rejects.toThrow(
      'GIGACHAT_CLIENT_SECRET',
    );
  });

  // ── OAuth token acquisition ─────────────────────────────────────────────

  it('acquires token from ngw.devices.sberbank.ru:9443/api/v2/oauth', async () => {
    queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const [tokenOpts] = mockRequest.mock.calls[0] as [Record<string, unknown>, ReqCallback];
    expect(tokenOpts.hostname).toBe('ngw.devices.sberbank.ru');
    expect(tokenOpts.port).toBe(9443);
    expect(tokenOpts.path).toBe('/api/v2/oauth');
    expect(tokenOpts.method).toBe('POST');
  });

  it('sends Basic auth header to token endpoint (base64 id:secret)', async () => {
    queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('my-id', 'my-secret').chat(MESSAGES);

    const [tokenOpts] = mockRequest.mock.calls[0] as [Record<string, unknown>, ReqCallback];
    const expected = Buffer.from('my-id:my-secret').toString('base64');
    expect((tokenOpts.headers as Record<string, string>)['Authorization']).toBe(`Basic ${expected}`);
  });

  it('caches token — second chat() does not re-acquire it', async () => {
    // First call: 1 token request + 1 chat request = 2 total
    queueTokenThenChat(200, OK_BODY);
    // Second call: 0 token (cached) + 1 chat = 1 total  → 3 overall
    queueResponse(200, OK_BODY);

    const p = new GigaChatProvider('id', 'secret');
    await p.chat(MESSAGES);
    await p.chat(MESSAGES);

    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it('refreshes token after the 25-minute TTL expires', async () => {
    vi.useFakeTimers();

    // First round: token + chat
    queueTokenThenChat(200, OK_BODY);
    // Second round (after expiry): new token + chat
    queueTokenThenChat(200, OK_BODY);

    const p = new GigaChatProvider('id', 'secret');
    await p.chat(MESSAGES);

    vi.advanceTimersByTime(26 * 60 * 1000); // past 25-min TTL

    await p.chat(MESSAGES);

    // 4 total: 2 token + 2 chat
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  // ── chat request shape ──────────────────────────────────────────────────

  it('sends chat request to gigachat.devices.sberbank.ru:443', async () => {
    queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const [chatOpts] = mockRequest.mock.calls[1] as [Record<string, unknown>, ReqCallback];
    expect(chatOpts.hostname).toBe('gigachat.devices.sberbank.ru');
    expect(chatOpts.port).toBe(443);
    expect(chatOpts.path).toBe('/api/v1/chat/completions');
    expect(chatOpts.method).toBe('POST');
  });

  it('sends Authorization: Bearer <token> in chat request', async () => {
    queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const [chatOpts] = mockRequest.mock.calls[1] as [Record<string, unknown>, ReqCallback];
    expect((chatOpts.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-token-abc',
    );
  });

  it('falls back to default model "GigaChat" (models[0]) when omitted', async () => {
    const chatReq = queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const writtenBody = JSON.parse((chatReq.write.mock.calls[0] as [Buffer])[0].toString());
    expect(writtenBody.model).toBe('GigaChat');
  });

  it('uses options.model when provided', async () => {
    const chatReq = queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES, { model: 'GigaChat-Pro' });

    const writtenBody = JSON.parse((chatReq.write.mock.calls[0] as [Buffer])[0].toString());
    expect(writtenBody.model).toBe('GigaChat-Pro');
  });

  it('passes temperature and max_tokens to chat body', async () => {
    const chatReq = queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES, { temperature: 0.4, maxTokens: 512 });

    const writtenBody = JSON.parse((chatReq.write.mock.calls[0] as [Buffer])[0].toString());
    expect(writtenBody.temperature).toBe(0.4);
    expect(writtenBody.max_tokens).toBe(512);
  });

  it('uses default temperature=0.7 and max_tokens=4096 when not provided', async () => {
    const chatReq = queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const writtenBody = JSON.parse((chatReq.write.mock.calls[0] as [Buffer])[0].toString());
    expect(writtenBody.temperature).toBe(0.7);
    expect(writtenBody.max_tokens).toBe(4096);
  });

  it('forwards messages array in chat body', async () => {
    const chatReq = queueTokenThenChat(200, OK_BODY);
    await new GigaChatProvider('id', 'secret').chat(MESSAGES);

    const writtenBody = JSON.parse((chatReq.write.mock.calls[0] as [Buffer])[0].toString());
    expect(writtenBody.messages).toEqual(MESSAGES);
  });

  // ── response parsing ─────────────────────────────────────────────────────

  it('returns content from choices[0].message.content', async () => {
    queueTokenThenChat(200, { choices: [{ message: { content: 'Ответ от GigaChat' } }] });
    const result = await new GigaChatProvider('id', 'secret').chat(MESSAGES);
    expect(result).toBe('Ответ от GigaChat');
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('throws when chat statusCode is 400 or higher', async () => {
    queueTokenThenChat(401, { message: 'Unauthorized' });
    await expect(new GigaChatProvider('id', 'secret').chat(MESSAGES)).rejects.toThrow('401');
  });

  it('includes "GigaChat error" prefix in thrown error for 4xx/5xx', async () => {
    queueTokenThenChat(403, { error: 'Forbidden' });
    await expect(new GigaChatProvider('id', 'secret').chat(MESSAGES)).rejects.toThrow('GigaChat error');
  });

  it('propagates network errors from the chat request', async () => {
    // Token request succeeds
    queueResponse(200, { access_token: 'tok' });

    // Chat request fires an error event on the req object
    mockRequest.mockImplementationOnce((_opts: unknown, _callback: ReqCallback) => {
      const mockReq = {
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === 'error') handler(new Error('connection reset'));
          return mockReq;
        }),
        write: vi.fn(),
        end: vi.fn(),
      };
      return mockReq;
    });

    await expect(new GigaChatProvider('id', 'secret').chat(MESSAGES)).rejects.toThrow(
      'connection reset',
    );
  });

  it('propagates token acquisition network errors', async () => {
    // Token request fires an error event
    mockRequest.mockImplementationOnce((_opts: unknown, _callback: ReqCallback) => {
      const mockReq = {
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === 'error') handler(new Error('token endpoint unreachable'));
          return mockReq;
        }),
        write: vi.fn(),
        end: vi.fn(),
      };
      return mockReq;
    });

    await expect(new GigaChatProvider('id', 'secret').chat(MESSAGES)).rejects.toThrow(
      'token endpoint unreachable',
    );
  });
});
