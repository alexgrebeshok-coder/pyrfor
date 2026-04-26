// @vitest-environment node
/**
 * Integration tests for POST /api/audio/transcribe.
 *
 * The voice module is mocked so no real Whisper binary / API key is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRuntimeGateway } from '../gateway.js';
import type { RuntimeConfig } from '../config.js';
import type { PyrforRuntime } from '../index.js';

process.env['LOG_LEVEL'] = 'silent';

// ─── Mock voice module ────────────────────────────────────────────────────

vi.mock('../voice.js', () => ({
  transcribeBuffer: vi.fn().mockResolvedValue('hello world'),
}));

import { transcribeBuffer } from '../voice.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeConfig(): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: { enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: [] },
    voice: { enabled: true, provider: 'openai', model: 'whisper-1' },
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return {} as unknown as PyrforRuntime;
}

/**
 * Build a minimal multipart/form-data body containing a single field `audio`
 * with the given buffer as the file data.
 */
function buildMultipart(
  fieldName: string,
  fileBuffer: Buffer,
  mimeType = 'audio/webm',
): { body: Buffer; contentType: string } {
  const boundary = 'testboundary1234';
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="audio.webm"\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([
    Buffer.from(header),
    fileBuffer,
    Buffer.from(footer),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/audio/transcribe', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;

  beforeEach(() => {
    vi.mocked(transcribeBuffer).mockResolvedValue('hello world');
  });

  afterEach(async () => {
    if (gw) {
      await gw.stop().catch(() => {});
      gw = null;
    }
  });

  it('returns 200 with { text } for a valid audio upload', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), portOverride: 0 });
    await gw.start();

    const fakeAudio = Buffer.from('RIFF....fake-wav-bytes', 'utf-8');
    const { body, contentType } = buildMultipart('audio', fakeAudio);

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).toBe('hello world');
    expect(vi.mocked(transcribeBuffer)).toHaveBeenCalledOnce();
  });

  it('returns 400 when content-type is not multipart/form-data', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/multipart/i);
  });

  it('returns 400 when "audio" field is missing from multipart body', async () => {
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), portOverride: 0 });
    await gw.start();

    // Send a valid multipart body but with a wrong field name
    const { body, contentType } = buildMultipart('file', Buffer.from('data'));

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/audio/i);
  });

  it('returns 401 when auth is required and no token is supplied', async () => {
    const config = makeConfig();
    config.gateway.bearerToken = 'secret-token';
    gw = createRuntimeGateway({ config, runtime: makeRuntime(), portOverride: 0 });
    await gw.start();

    const fakeAudio = Buffer.from('fake');
    const { body, contentType } = buildMultipart('audio', fakeAudio);

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(res.status).toBe(401);
  });

  it('returns 500 when transcribeBuffer throws', async () => {
    vi.mocked(transcribeBuffer).mockRejectedValue(new Error('whisper failed'));
    gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), portOverride: 0 });
    await gw.start();

    const { body, contentType } = buildMultipart('audio', Buffer.from('data'));

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('whisper failed');
  });
});
