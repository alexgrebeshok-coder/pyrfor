// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';
import type { StreamEvent } from '../streaming';

process.env['LOG_LEVEL'] = 'silent';

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

function parseSSE(raw: string): unknown[] {
  return raw
    .split(/\n\n+/)
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: '))?.slice('data: '.length))
    .filter((line): line is string => typeof line === 'string')
    .map((line) => JSON.parse(line));
}

function makeRuntime(events: StreamEvent[]): PyrforRuntime {
  return {
    streamChatRequest: vi.fn().mockImplementation(async function* () {
      for (const event of events) yield event;
    }),
    handleMessage: vi.fn(),
  } as unknown as PyrforRuntime;
}

describe('POST /agent/run', () => {
  let gateway: ReturnType<typeof createRuntimeGateway> | null = null;

  afterEach(async () => {
    if (gateway) {
      await gateway.stop().catch(() => {});
      gateway = null;
    }
  });

  it('streams AG-UI events over SSE', async () => {
    const runtime = makeRuntime([
      { type: 'run', sessionId: 'sess-1', runId: 'runtime-run-1', taskId: 'task-1' },
      { type: 'token', text: 'Found 3 results' },
      { type: 'tool', name: 'search', args: { q: 'test' } },
      { type: 'tool_result', name: 'search', ok: true, result: { hits: 3 } },
      { type: 'final', text: 'Found 3 results' },
    ]);

    gateway = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gateway.start();

    const res = await fetch(`http://127.0.0.1:${gateway.port}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'search test',
        messages: [{ id: 'm1', role: 'user', content: 'search test' }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSSE(await res.text()) as Array<{ type: string }>;
    expect(events[0]?.type).toBe('RUN_STARTED');
    expect(events[1]?.type).toBe('STATE_SNAPSHOT');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'RUN_FINISHED',
    ]));
  });

  it('derives prompt text from user messages and threads it into the runtime call', async () => {
    const runtime = makeRuntime([{ type: 'final', text: 'ok' }]);
    gateway = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gateway.start();

    await fetch(`http://127.0.0.1:${gateway.port}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thread-1',
        messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello from thread' }] }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    }).then((response) => response.text());

    expect(runtime.streamChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello from thread',
      sessionId: 'thread-1',
      signal: expect.any(AbortSignal),
    }));
  });
});
