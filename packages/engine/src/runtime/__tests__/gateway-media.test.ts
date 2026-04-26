// @vitest-environment node
/**
 * Tests for media-attachment support on /api/chat/stream and the
 * /api/media/:sessionId/:filename serving route.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfig } from '../config.js';
import type { PyrforRuntime } from '../index.js';
import type { StreamEvent } from '../streaming.js';

process.env['LOG_LEVEL'] = 'silent';

// Mock processPhoto so no real OpenAI vision call is made.
vi.mock('../media/process-photo.js', () => ({
  processPhoto: vi.fn().mockResolvedValue({
    enrichedPrompt: 'Mocked enriched prompt',
    description: 'A mocked description of an image with a cat.',
    used: 'fallback',
  }),
}));

// Mock voice transcription to avoid hitting real services.
vi.mock('../voice.js', () => ({
  transcribeBuffer: vi.fn().mockResolvedValue('mocked transcript'),
}));

import { createRuntimeGateway } from '../gateway.js';

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

function makeRuntime(events: StreamEvent[]): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
    streamChatRequest: vi.fn().mockImplementation(async function* () {
      for (const e of events) yield e;
    }),
  } as unknown as PyrforRuntime;
}

function buildMultipart(parts: Array<{
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}>): { body: Buffer; contentType: string } {
  const boundary = 'testboundaryMEDIA1234';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) header += `; filename="${p.filename}"`;
    header += '\r\n';
    if (p.contentType) header += `Content-Type: ${p.contentType}\r\n`;
    header += '\r\n';
    chunks.push(Buffer.from(header));
    if (p.data) chunks.push(p.data);
    else chunks.push(Buffer.from(p.value ?? ''));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseSSE(raw: string): Array<{ event?: string; data: unknown }> {
  const out: Array<{ event?: string; data: unknown }> = [];
  for (const msg of raw.split(/\n\n+/)) {
    if (!msg.trim()) continue;
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of msg.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
    }
    if (dataLine !== undefined) {
      let data: unknown = dataLine;
      try { data = JSON.parse(dataLine); } catch { /* keep as string */ }
      out.push({ event, data });
    }
  }
  return out;
}

describe('POST /api/chat/stream multipart with attachments', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  let mediaDir: string | null = null;

  afterEach(async () => {
    if (gw) { await gw.stop().catch(() => {}); gw = null; }
    if (mediaDir) {
      try { rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
      mediaDir = null;
    }
  });

  it('accepts multipart with image, returns attachments and image description in stream', async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), 'pyrfor-media-test-'));
    const runtime = makeRuntime([{ type: 'final', text: 'ok' }]);
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime,
      portOverride: 0,
      mediaDir,
    });
    await gw.start();

    // Tiny fake PNG header bytes — content doesn't matter since processPhoto is mocked.
    const fakePng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);

    const { body, contentType } = buildMultipart([
      { name: 'text', value: 'describe this' },
      { name: 'sessionId', value: 'sess-abc' },
      {
        name: 'attachments[]',
        filename: 'pic.png',
        contentType: 'image/png',
        data: fakePng,
      },
    ]);

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': String(body.length) },
      body,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    const events = parseSSE(raw);

    // First data event should carry the attachments alongside the runtime event.
    const dataEvents = events.filter((e) => !e.event);
    expect(dataEvents.length).toBeGreaterThan(0);
    const first = dataEvents[0].data as {
      type: string;
      attachments?: Array<{ kind: string; url: string; mime: string; size: number }>;
    };
    expect(first.attachments).toBeDefined();
    expect(first.attachments!.length).toBe(1);
    expect(first.attachments![0].kind).toBe('image');
    expect(first.attachments![0].mime).toBe('image/png');
    expect(first.attachments![0].url).toMatch(/\/api\/media\/sess-abc\/[A-Za-z0-9._-]+\.png$/);
    expect(first.attachments![0].size).toBe(fakePng.length);

    // Image description should have been appended to the prompt.
    const streamCall = (runtime.streamChatRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(String(streamCall.text)).toContain('[Image description: A mocked description');

    // Done event should be present.
    expect(events.find((e) => e.event === 'done')).toBeDefined();
  });

  it('JSON path on /api/chat/stream still works (backward compat)', async () => {
    const runtime = makeRuntime([{ type: 'final', text: 'ok' }]);
    gw = createRuntimeGateway({ config: makeConfig(), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });

    expect(res.status).toBe(200);
    const events = parseSSE(await res.text());
    const dataEvents = events.filter((e) => !e.event);
    expect(dataEvents.length).toBe(1);
    // No attachments field on plain JSON path
    expect((dataEvents[0].data as { attachments?: unknown }).attachments).toBeUndefined();
  });
});

describe('GET /api/media/:sessionId/:filename', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;
  let mediaDir: string | null = null;

  afterEach(async () => {
    if (gw) { await gw.stop().catch(() => {}); gw = null; }
    if (mediaDir) {
      try { rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
      mediaDir = null;
    }
  });

  it('rejects path traversal in sessionId or filename', async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), 'pyrfor-media-test-'));
    const runtime = makeRuntime([]);
    gw = createRuntimeGateway({ config: makeConfig(), runtime, portOverride: 0, mediaDir });
    await gw.start();

    // ../../../etc/passwd as full rest → segments split mismatch → 400
    const r1 = await fetch(`http://127.0.0.1:${gw.port}/api/media/..%2F..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(r1.status);

    const r2 = await fetch(`http://127.0.0.1:${gw.port}/api/media/session/..%2F..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(r2.status);

    // Two-segment URL with .. in segment values must be rejected by the safe-name regex.
    const r3 = await fetch(`http://127.0.0.1:${gw.port}/api/media/..%2Fevil/file.png`);
    expect([400, 404]).toContain(r3.status);
  });

  it('returns 404 for valid-looking but missing files', async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), 'pyrfor-media-test-'));
    const runtime = makeRuntime([]);
    gw = createRuntimeGateway({ config: makeConfig(), runtime, portOverride: 0, mediaDir });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/media/valid-session/valid-file.png`);
    expect(res.status).toBe(404);
  });

  it('serves an existing file with the right mime type', async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), 'pyrfor-media-test-'));
    mkdirSync(path.join(mediaDir, 'sess1'), { recursive: true });
    const fileBytes = Buffer.from([1, 2, 3, 4]);
    writeFileSync(path.join(mediaDir, 'sess1', 'thing.png'), fileBytes);

    const runtime = makeRuntime([]);
    gw = createRuntimeGateway({ config: makeConfig(), runtime, portOverride: 0, mediaDir });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/media/sess1/thing.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(fileBytes)).toBe(true);
  });
});
