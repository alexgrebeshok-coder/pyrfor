// @vitest-environment node
/**
 * Tests for POST /api/chat/stream SSE endpoint.
 *
 * Uses the same gateway-port harness pattern as gateway-port.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';
import type { StreamEvent } from '../streaming';

// Silence logger
process.env['LOG_LEVEL'] = 'silent';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(port = 0): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping'],
    },
  } as unknown as RuntimeConfig;
}

/** Creates a PyrforRuntime mock with a configurable streamChatRequest generator. */
function makeRuntime(events: StreamEvent[]): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({
      success: true,
      response: 'ok',
      sessionId: 'sess-1',
      runId: 'run-1',
      taskId: 'task-1',
    }),
    streamChatRequest: vi.fn().mockImplementation(async function* () {
      for (const e of events) yield e;
    }),
  } as unknown as PyrforRuntime;
}

/**
 * Parse raw SSE text into an array of objects:
 * [{ event?: string, data: unknown }, ...]
 */
function parseSSE(raw: string): Array<{ event?: string; data: unknown }> {
  const parsed: Array<{ event?: string; data: unknown }> = [];
  // Split on double newline (SSE message boundary)
  const messages = raw.split(/\n\n+/);
  for (const msg of messages) {
    if (!msg.trim()) continue;
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of msg.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length).trim();
      if (line.startsWith('data: ')) dataLine = line.slice('data: '.length).trim();
    }
    if (dataLine !== undefined) {
      let data: unknown = dataLine;
      try { data = JSON.parse(dataLine); } catch { /* keep as string */ }
      parsed.push({ event, data });
    }
  }
  return parsed;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/chat/stream', () => {
  let gw: ReturnType<typeof createRuntimeGateway> | null = null;

  afterEach(async () => {
    if (gw) {
      await gw.stop().catch(() => {});
      gw = null;
    }
    delete process.env['PYRFOR_PORT'];
  });

  it('responds with 200 and text/event-stream content-type', async () => {
    const runtime = makeRuntime([
      { type: 'token', text: 'hello' },
      { type: 'final', text: 'hello' },
    ]);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.text(); // drain
  });

  it('streams generator events as SSE data lines', async () => {
    const genEvents: StreamEvent[] = [
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ' World' },
      { type: 'final', text: 'Hello World' },
    ];
    const runtime = makeRuntime(genEvents);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'say hello' }),
    });

    const raw = await res.text();
    const messages = parseSSE(raw);

    // Expect data events for each generator event + a done event
    const dataEvents = messages.filter((m) => !m.event); // no named event = generator data
    expect(dataEvents).toHaveLength(genEvents.length);
    expect(dataEvents[0].data).toEqual({ type: 'token', text: 'Hello' });
    expect(dataEvents[1].data).toEqual({ type: 'token', text: ' World' });
    expect(dataEvents[2].data).toEqual({ type: 'final', text: 'Hello World' });

    // Expect a terminal `done` event
    const doneEvt = messages.find((m) => m.event === 'done');
    expect(doneEvt).toBeDefined();
  });

  it('event order: token → tool → tool_result → final → done', async () => {
    const genEvents: StreamEvent[] = [
      { type: 'token', text: 'using tool...' },
      { type: 'tool', name: 'search', args: { q: 'test' } },
      { type: 'tool_result', name: 'search', result: { hits: 3 } },
      { type: 'token', text: 'Found 3 results' },
      { type: 'final', text: 'Found 3 results' },
    ];
    const runtime = makeRuntime(genEvents);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'search test' }),
    });

    const raw = await res.text();
    const messages = parseSSE(raw);

    const dataEvents = messages.filter((m) => !m.event);
    const types = dataEvents.map((m) => (m.data as { type: string }).type);

    expect(types).toEqual(['token', 'tool', 'tool_result', 'token', 'final']);

    const finalIdx = types.indexOf('final');
    const toolIdx = types.indexOf('tool');
    expect(toolIdx).toBeLessThan(finalIdx);

    const doneEvt = messages.find((m) => m.event === 'done');
    expect(doneEvt).toBeDefined();
  });

  it('returns 400 for missing text field', async () => {
    const runtime = makeRuntime([]);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openFiles: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('sends error SSE event when streamChatRequest throws', async () => {
    const runtime = {
      handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
      streamChatRequest: vi.fn().mockImplementation(async function* () {
        throw new Error('provider_unavailable');
        // eslint-disable-next-line no-unreachable
        yield {} as StreamEvent; // make TS happy about generator type
      }),
    } as unknown as PyrforRuntime;

    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    // SSE is always 200
    expect(res.status).toBe(200);
    const raw = await res.text();
    const messages = parseSSE(raw);
    const errorEvt = messages.find((m) => m.event === 'error');
    expect(errorEvt).toBeDefined();
    expect((errorEvt!.data as { message: string }).message).toContain('provider_unavailable');
  });

  it('passes openFiles, workspace, and sessionId to streamChatRequest', async () => {
    const runtime = makeRuntime([{ type: 'final', text: 'ok' }]);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    await fetch(`http://127.0.0.1:${gw.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'hello',
        openFiles: [{ path: 'src/a.ts', content: 'const x = 1;' }],
        workspace: '/some/workspace',
        sessionId: 'sess-123',
      }),
    }).then((r) => r.text());

    expect(runtime.streamChatRequest).toHaveBeenCalledWith({
      text: 'hello',
      openFiles: [{ path: 'src/a.ts', content: 'const x = 1;' }],
      workspace: '/some/workspace',
      sessionId: 'sess-123',
      prefer: undefined,
      routingHints: undefined,
    });
  });

  it('POST /api/chat still works unchanged (backward compat)', async () => {
    const runtime = makeRuntime([]);
    gw = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gw.start();

    const res = await fetch(`http://127.0.0.1:${gw.port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { reply: string; sessionId?: string; runId?: string; taskId?: string };
    expect(body.reply).toBe('ok');
    expect(body.sessionId).toBe('sess-1');
    expect(body.runId).toBe('run-1');
    expect(body.taskId).toBe('task-1');
  });
});
