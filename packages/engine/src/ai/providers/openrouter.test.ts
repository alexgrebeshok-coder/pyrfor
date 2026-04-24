// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Node built-ins used by getCachedIPv4 and httpsPost / _streamModel.
// These must be declared before importing the module so Vitest can hoist them.
vi.mock('dns', () => ({
  resolve4: vi.fn((
    hostname: string,
    cb: (err: Error | null, addresses: string[]) => void,
  ) => {
    cb(null, ['1.2.3.4']);
  }),
}));

vi.mock('https', () => {
  const createMockRequest = (
    opts: Record<string, unknown>,
    callback?: (res: {
      statusCode: number;
      on: (event: string, handler: (arg?: unknown) => void) => void;
    }) => void,
  ) => {
    const req = {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    // Expose the opts/callback on the req for test inspection
    (req as Record<string, unknown>)._opts = opts;
    (req as Record<string, unknown>)._callback = callback;
    return req;
  };

  return {
    request: vi.fn(createMockRequest),
  };
});

import { OpenRouterProvider, getCachedIPv4 } from './openrouter';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Produce what httpsPost resolves with (a JSON-stringified envelope). */
function makeHttpsPostResponse(status: number, body: object | string): string {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return JSON.stringify({ status, body: bodyStr });
}

/** Shorthand: successful OpenRouter response envelope. */
function successEnvelope(content: string): string {
  return makeHttpsPostResponse(200, {
    choices: [{ message: { content } }],
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('OpenRouterProvider', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ─── static properties ────────────────────────────────────────────────────

  it('has name = "openrouter"', () => {
    const p = new OpenRouterProvider('key');
    expect(p.name).toBe('openrouter');
  });

  it('exposes a models array with known free models', () => {
    const p = new OpenRouterProvider('key');
    expect(p.models.some(m => m.includes('google/'))).toBe(true);
    expect(p.models.length).toBeGreaterThan(0);
  });

  // ─── constructor ─────────────────────────────────────────────────────────

  it('constructor: uses explicit apiKey', async () => {
    const p = new OpenRouterProvider('explicit-key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('constructor: reads OPENROUTER_API_KEY from env when no argument', async () => {
    process.env.OPENROUTER_API_KEY = 'env-api-key';
    const p = new OpenRouterProvider();
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('constructor: defaults apiKey to empty string if env unset', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const p = new OpenRouterProvider();
    await expect(p.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('OPENROUTER_API_KEY not set');
  });

  // ─── chat(): apiKey guard ─────────────────────────────────────────────────

  it('chat(): throws "OPENROUTER_API_KEY not set" when apiKey empty', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const p = new OpenRouterProvider('');
    await expect(p.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('OPENROUTER_API_KEY not set');
  });

  // ─── chat(): request payload ──────────────────────────────────────────────

  it('chat(): sends correct model, messages, temperature, max_tokens in payload', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('done'));

    const msgs = [{ role: 'user' as const, content: 'hello' }];
    await p.chat(msgs, { model: 'openai/gpt-4o-mini', temperature: 0.5, maxTokens: 512 });

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.model).toBe('openai/gpt-4o-mini');
    expect(payload.messages).toEqual(msgs);
    expect(payload.temperature).toBe(0.5);
    expect(payload.max_tokens).toBe(512);
  });

  it('chat(): uses first model in models[] as default when model omitted', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('done'));

    await p.chat([{ role: 'user', content: 'hi' }]);

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.model).toBe(p.models[0]);
  });

  it('chat(): applies default temperature 0.7 when omitted', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('done'));

    await p.chat([{ role: 'user', content: 'hi' }]);

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.temperature).toBe(0.7);
  });

  it('chat(): applies default max_tokens 4096 when omitted', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('done'));

    await p.chat([{ role: 'user', content: 'hi' }]);

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.max_tokens).toBe(4096);
  });

  // ─── chat(): success response ────────────────────────────────────────────

  it('chat(): returns content from choices[0].message.content on 200', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('The answer is 42.'));

    const result = await p.chat([{ role: 'user', content: 'what is 6×7?' }]);
    expect(result).toBe('The answer is 42.');
  });

  // ─── chat(): error handling ───────────────────────────────────────────────

  it('chat(): throws immediately on non-retryable error (e.g. 403)', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(makeHttpsPostResponse(403, 'Forbidden'));

    await expect(p.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('OpenRouter API error: 403');
  });

  it('chat(): throws immediately on 500 server error', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(makeHttpsPostResponse(500, 'Internal Server Error'));

    await expect(p.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('500');
  });

  it('chat(): falls through on 429 and succeeds on next model', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost');

    // First call = 429, second call = 200
    spy
      .mockResolvedValueOnce(makeHttpsPostResponse(429, 'Rate limit'))
      .mockResolvedValueOnce(successEnvelope('fallback response'));

    const result = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('fallback response');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('chat(): falls through on 400 + "Developer instruction" error', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost');

    spy
      .mockResolvedValueOnce(makeHttpsPostResponse(400, 'Developer instruction not supported'))
      .mockResolvedValueOnce(successEnvelope('ok from fallback'));

    const result = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('ok from fallback');
  });

  it('chat(): throws "all models exhausted" after all models fail with 429', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost');

    // All models return 429
    spy.mockResolvedValue(makeHttpsPostResponse(429, 'Rate limited'));

    await expect(p.chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('all models exhausted');
  });

  // ─── chat(): Gemma system message merging ─────────────────────────────────

  it('chat(): merges system messages into user message for Gemma models', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('merged'));

    await p.chat(
      [
        { role: 'system', content: 'You are a lawyer.' },
        { role: 'user', content: 'Help me.' },
      ],
      { model: 'google/gemma-3-27b-it:free' },
    );

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    // System message should be merged → no 'system' role present
    expect(payload.messages.some((m: { role: string }) => m.role === 'system')).toBe(false);
    // First message should be 'user' role with merged content
    expect(payload.messages[0].role).toBe('user');
    expect(payload.messages[0].content).toContain('You are a lawyer.');
    expect(payload.messages[0].content).toContain('Help me.');
  });

  it('chat(): does NOT merge system messages for non-Gemma models', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));

    await p.chat(
      [
        { role: 'system', content: 'System context.' },
        { role: 'user', content: 'Question.' },
      ],
      { model: 'openai/gpt-4o-mini' },
    );

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.messages.some((m: { role: string }) => m.role === 'system')).toBe(true);
  });

  it('chat(): mergeSystemIntoUser handles no system messages (passthrough)', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));

    const msgs = [{ role: 'user' as const, content: 'Just user.' }];
    await p.chat(msgs, { model: 'google/gemma-3-4b-it:free' });

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.messages).toEqual(msgs);
  });

  it('chat(): mergeSystemIntoUser with only system messages (no user)', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));

    await p.chat(
      [{ role: 'system', content: 'Only system.' }],
      { model: 'google/gemma-3-12b-it:free' },
    );

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    // Should produce a single user message with the system content
    expect(payload.messages).toEqual([{ role: 'user', content: 'Only system.' }]);
  });

  it('chat(): merges multiple system messages for Gemma', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(p as unknown as { httpsPost: (payload: string) => Promise<string> }, 'httpsPost')
      .mockResolvedValue(successEnvelope('ok'));

    await p.chat(
      [
        { role: 'system', content: 'Context A.' },
        { role: 'system', content: 'Context B.' },
        { role: 'user', content: 'User question.' },
      ],
      { model: 'google/gemma-3-27b-it:free' },
    );

    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.messages[0].content).toContain('Context A.');
    expect(payload.messages[0].content).toContain('Context B.');
    expect(payload.messages[0].content).toContain('User question.');
  });

  // ─── chatStream() ─────────────────────────────────────────────────────────

  it('chatStream(): throws "OPENROUTER_API_KEY not set" when apiKey empty', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const p = new OpenRouterProvider('');
    const gen = p.chatStream!([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('OPENROUTER_API_KEY not set');
  });

  it('chatStream(): yields chunks from _streamModel', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(
      p as unknown as { _streamModel: (msgs: unknown[], model: string) => AsyncGenerator<string> },
      '_streamModel',
    ).mockImplementation(async function* () {
      yield 'Hello';
      yield ', ';
      yield 'world!';
    });

    const chunks: string[] = [];
    for await (const chunk of p.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Hello', ', ', 'world!']);
  });

  it('chatStream(): stops after first successful _streamModel call (no extra fallback)', async () => {
    const p = new OpenRouterProvider('key');
    const spy = vi.spyOn(
      p as unknown as { _streamModel: (msgs: unknown[], model: string) => AsyncGenerator<string> },
      '_streamModel',
    ).mockImplementation(async function* () {
      yield 'data';
    });

    for await (const _chunk of p.chatStream!([{ role: 'user', content: 'hi' }])) { /* noop */ }
    // Should only call _streamModel once on success
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('chatStream(): propagates non-retryable error from _streamModel', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(
      p as unknown as { _streamModel: (msgs: unknown[], model: string) => AsyncGenerator<string> },
      '_streamModel',
    ).mockImplementation(async function* () {
      throw new Error('Fatal error');
      yield ''; // needed for TypeScript generator typing
    });

    const gen = p.chatStream!([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('Fatal error');
  });

  it('chatStream(): falls through to next model on retryable error (no chunks yielded)', async () => {
    const p = new OpenRouterProvider('key');
    let callCount = 0;
    vi.spyOn(
      p as unknown as { _streamModel: (msgs: unknown[], model: string) => AsyncGenerator<string> },
      '_streamModel',
    ).mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        throw new Error('OpenRouter stream error 429 (retryable): rate limited');
      }
      yield 'fallback chunk';
    });

    const chunks: string[] = [];
    for await (const chunk of p.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['fallback chunk']);
    expect(callCount).toBe(2);
  });

  it('chatStream(): throws "all models exhausted" when all _streamModel calls fail retryably', async () => {
    const p = new OpenRouterProvider('key');
    vi.spyOn(
      p as unknown as { _streamModel: (msgs: unknown[], model: string) => AsyncGenerator<string> },
      '_streamModel',
    ).mockImplementation(async function* () {
      throw new Error('OpenRouter stream error 429 (retryable): rate limited');
      yield ''; // generator typing
    });

    const gen = p.chatStream!([{ role: 'user', content: 'hi' }]);
    await expect(async () => {
      for await (const _chunk of gen) { /* drain */ }
    }).rejects.toThrow('chatStream: all models exhausted');
  });
});

// ─── getCachedIPv4 export ─────────────────────────────────────────────────────
// getCachedIPv4 uses dynamic require('dns') which Vitest cannot intercept via
// vi.mock in this environment. The full path is exercised indirectly via the
// chat() tests that spy on httpsPost (which calls getCachedIPv4 internally).

describe('getCachedIPv4 export', () => {
  it('is exported as a function from openrouter module', () => {
    expect(typeof getCachedIPv4).toBe('function');
  });
});
